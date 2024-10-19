import { getRandomBit } from "$lib/get-random-bit.js";
import { getRandomInt } from "$lib/get-random-int.js";
import { getTwoPointsDist } from "$lib/get-two-points-dist.js";

import type { WorkerInitData, MessageForm } from "./types.ts";


export class CellsState {
    xLen: number;
    yLen: number;
    sharedBuffer: SharedArrayBuffer;
    leftArray: Uint8Array;
    rightArray: Uint8Array;
    indication: Uint8Array;

    constructor(xLen: number, yLen: number, sharedBuffer?: SharedArrayBuffer) {
        this.xLen = xLen;
        this.yLen = yLen;

        // "3 * xLen * yLen":
        //      1. 1/3 is leftArray, 2. 1/3 is rightArray, both alternates with current and next state.
        //      3. 1/3 is lastStateArray, used by rendering.
        // "+ 1": indicates which array represents current state (0 -> leftArray, 1 -> rightArray).
        this.sharedBuffer = sharedBuffer || new SharedArrayBuffer(3 * xLen * yLen + 1);
        this.leftArray = new Uint8Array(this.sharedBuffer, 0, xLen * yLen);
        this.rightArray = new Uint8Array(this.sharedBuffer, xLen * yLen, xLen * yLen);
        this.indication = new Uint8Array(this.sharedBuffer, 3 * xLen * yLen, 1);
    }

    getCurrent = (): Uint8Array => this.indication[0] === 0 ? this.leftArray : this.rightArray;

    getNext = (): Uint8Array => this.indication[0] === 1 ? this.leftArray : this.rightArray;

    switchIndication = (): void => {
        this.indication[0] = this.indication[0] === 0 ? 1 : 0;
    };
}


let cellsState: CellsState;
let arrayScopeOffsetStart: number;
let arrayScopeOffsetEnd: number;


const cellsMachine = {
    bRules: <Set<number>> new Set(),
    sRules: <Set<number>> new Set(),

    random(passes: number): void {
        for (let i = 0; i < passes; i++) {
            const currentState = cellsState.getCurrent();
            const centerCol = getRandomInt(0, cellsState.xLen);
            const centerRow = getRandomInt(0, cellsState.yLen);
            const radius = getRandomInt(2, (cellsState.xLen < cellsState.yLen ? cellsState.xLen : cellsState.yLen) * 0.1)

            for (let x = 0; x < cellsState.xLen; x++) {
                for (let y = 0; y < cellsState.yLen; y++) {
                    if (getTwoPointsDist(centerCol, centerRow, x, y) <= radius) {
                        currentState[y * cellsState.xLen + x] = getRandomBit();
                    }
                }
            }
        }
    },

    evolve(): void {
        const currentState = cellsState.getCurrent();
        const nextState = cellsState.getNext();

        for (let index = arrayScopeOffsetStart; index < arrayScopeOffsetEnd; index++) {
            const isAlive = currentState[index] === 1;
            let neighborsAliveCount = 0;

            const [x, y] = [index % cellsState.xLen, Math.floor(index / cellsState.xLen)];

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;

                    const nx = (x + dx + cellsState.xLen) % cellsState.xLen;
                    const ny = (y + dy + cellsState.yLen) % cellsState.yLen;

                    if (currentState[ny * cellsState.xLen + nx] === 1) neighborsAliveCount++;
                }
            }

            if (!isAlive && this.bRules.has(neighborsAliveCount)) {
                nextState[index] = 1;
            } else if (isAlive && this.sRules.has(neighborsAliveCount)) {
                nextState[index] = 1;
            } else {
                nextState[index] = 0;
            }
        }
    },

    initRules(bRules: Array<number>, sRules: Array<number>): void {
        this.bRules = new Set(bRules);
        this.sRules = new Set(sRules);
    },

    clear(): void {
        cellsState.getCurrent().fill(0, arrayScopeOffsetStart, arrayScopeOffsetEnd);
    }
};


const renderer = {
    cellSize: <number> 0,
    lastStateToRender: <Uint8Array> new Uint8Array(0),
    canvas: <OffscreenCanvas | null> null,
    ctx: <OffscreenCanvasRenderingContext2D | null> null,
    imageData: <ImageData | null> null,

    init(cellSize: number, offscreen: OffscreenCanvas, width: number, height: number, cellImageDataArray: Uint8ClampedArray) {
        this.cellSize = cellSize;
        this.lastStateToRender = new Uint8Array(cellsState.sharedBuffer, 2 * cellsState.xLen * cellsState.yLen, cellsState.xLen * cellsState.yLen);
        this.canvas = offscreen;
        this.ctx = this.canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D; // "willReadFrequently: true" is temp fix for chromium performance, perphaps try WebGL later on.
        this.canvas.width = width;
        this.canvas.height = height;
        this.imageData = new ImageData(cellImageDataArray, cellSize, cellSize);
    },

    draw(): void {
        for (let index = arrayScopeOffsetStart; index < arrayScopeOffsetEnd; index++) {
            const x = (index - arrayScopeOffsetStart) % cellsState.xLen;
            const y = Math.floor((index - arrayScopeOffsetStart) / cellsState.xLen);

            const valueAtCurrentIndex = cellsState.getCurrent()[index];

            if (valueAtCurrentIndex !== this.lastStateToRender[index]) {
                if (valueAtCurrentIndex !== 0) {
                    this.drawCell(x, y);
                } else {
                    this.clearCell(x, y);
                }

                this.lastStateToRender[index] = valueAtCurrentIndex;
            }
        }
    },

    drawCell(col: number, row: number): void {
        const x = col * this.cellSize;
        const y = row * this.cellSize;

        (this.ctx as OffscreenCanvasRenderingContext2D).putImageData((this.imageData as ImageData), x, y);
    },

    clearCell(col: number, row: number): void {
        const x = col * this.cellSize;
        const y = row * this.cellSize;

        (this.ctx as OffscreenCanvasRenderingContext2D).clearRect(x, y, this.cellSize, this.cellSize);
    }
};


function relay(ev: MessageEvent<MessageForm>): void {
    switch (ev.data.type) {
        case "<INIT>":
            const input: WorkerInitData["input"] = ev.data.input;

            if ((cellsState?.xLen === input?.xLen) && (cellsState?.yLen === input?.yLen)) {
                const stateSnapshot = cellsState.getCurrent();

                cellsState = new CellsState(input.xLen, input.yLen, input.sharedBuffer);
                cellsState.getCurrent().set(stateSnapshot);
            } else {
                cellsState = new CellsState(input.xLen, input.yLen, input.sharedBuffer);
            }

            cellsMachine.initRules(input.rules.b, input.rules.s);
            renderer.init(input.cellSize, input.offscreen, input.canvasWidth, input.canvasScopeHeight, input.cellImageDataArray)

            arrayScopeOffsetStart = input.arrayScopeOffsetStart;
            arrayScopeOffsetEnd = input.arrayScopeOffsetEnd;
            break;
        case "<EVOLVE>":
            cellsMachine.evolve();
            break;
        case "<RENDER>":
            renderer.draw();
            break;
        case "<CHANGE-RULES>":
            cellsMachine.initRules(ev.data.input.rules.b, ev.data.input.rules.s);
            break;
        case "<RANDOM>":
            cellsMachine.random(ev.data.input);
            break;
        case "<CLEAR>":
            cellsMachine.clear();
            break;
        default:
            self.postMessage({ type: "<ERROR>", input: `worker received unknown type of message: ${JSON.stringify(ev.data)}` });
    }

    self.postMessage({ type: "<WAITING-AFTER>", input: ev.data.type });
}

self.addEventListener("unhandledrejection", (ev): void => self.postMessage({ type: "<ERROR>", input: `worker unhandled rejection | ${ev.reason}` }));
self.addEventListener("message", (ev): void => relay(ev));