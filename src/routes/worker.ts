import { getRandomBit } from "libjs/generic/get-random-bit.js";
import { getRandomInt } from "libjs/generic/get-random-int.js";
import { getTwoPointsDist } from "libjs/generic/get-two-points-dist.js";

import type { MessageForm } from "$lib/types.ts";
import type { WorkerInitData } from "./types.js";


function genCircleImageBitmap(size: number, padding: number = 0, color: string = "#ff8131"): Promise<ImageBitmap> {
    const offscreen: OffscreenCanvas = new OffscreenCanvas(size, size);
    const ctx: OffscreenCanvasRenderingContext2D = offscreen.getContext("2d")!;
    const radius: number = size / 2;

    ctx.fillStyle = color;

    if (size > 1) {
        ctx.arc(radius, radius, radius - padding, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillRect(0, 0, 1, 1);
    }

    return createImageBitmap(offscreen);
}


let arrayScopeOffsetStart: number;
let arrayScopeOffsetEnd: number;

let cellsState: CellsState;
let cellsMachine: CellsMachine;
let cellsRenderer: CellsRenderer;


export class CellsState {
    xLen: number;
    yLen: number;
    sharedBuffer: SharedArrayBuffer;
    leftArray: Uint8Array;
    rightArray: Uint8Array;
    lastStateArray: Uint8Array;
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
        this.lastStateArray = new Uint8Array(this.sharedBuffer, 2 * xLen * yLen, xLen * yLen);
        this.indication = new Uint8Array(this.sharedBuffer, 3 * xLen * yLen, 1);
    }

    getCurrent = (): Uint8Array => this.indication[0] === 0 ? this.leftArray : this.rightArray;

    getNext = (): Uint8Array => this.indication[0] === 1 ? this.leftArray : this.rightArray;

    switchIndication = (): number => this.indication[0] = this.indication[0] === 0 ? 1 : 0;
}


class CellsMachine  {
    bRules: Set<number>;
    sRules: Set<number>;

    constructor(bRules: Set<number>, sRules: Set<number>) {
        this.bRules = bRules;
        this.sRules = sRules;
    }

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
    }

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
    }

    clear(): void {
        cellsState.getCurrent().fill(0, arrayScopeOffsetStart, arrayScopeOffsetEnd);
    }
}


class CellsRenderer {
    cellSize: number;
    canvas: OffscreenCanvas;
    ctx: OffscreenCanvasRenderingContext2D;
    cellBitmap: ImageBitmap;

    constructor(cellSize: number, offscreen: OffscreenCanvas, width: number, height: number, cellBitmap: ImageBitmap) {
        this.cellSize = cellSize;
        this.canvas = offscreen;
        this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
        this.canvas.width = width;
        this.canvas.height = height;
        this.cellBitmap = cellBitmap;
    }

    draw(): void {
        for (let index = arrayScopeOffsetStart; index < arrayScopeOffsetEnd; index++) {
            const x = (index - arrayScopeOffsetStart) % cellsState.xLen;
            const y = Math.floor((index - arrayScopeOffsetStart) / cellsState.xLen);

            const valueAtCurrentIndex = cellsState.getCurrent()[index];

            if (valueAtCurrentIndex !== cellsState.lastStateArray[index]) {
                if (valueAtCurrentIndex !== 0) {
                    this.drawCell(x, y);
                } else {
                    this.clearCell(x, y);
                }

                cellsState.lastStateArray[index] = valueAtCurrentIndex;
            }
        }
    }

    drawCell(col: number, row: number): void {
        const x = col * this.cellSize;
        const y = row * this.cellSize;

        this.ctx.drawImage(this.cellBitmap, x, y);
    }

    clearCell(col: number, row: number): void {
        const x = col * this.cellSize;
        const y = row * this.cellSize;

        this.ctx.clearRect(x, y, this.cellSize, this.cellSize);
    }
}


async function relay(ev: MessageEvent<MessageForm>): Promise<void> {
    switch (ev.data.type) {
        case "<INIT>":
            const input: WorkerInitData["input"] = ev.data.input;
            const cellBitmap: ImageBitmap = await genCircleImageBitmap(input.cellSize, input.cellPadding);

            arrayScopeOffsetStart = input.arrayScopeOffsetStart;
            arrayScopeOffsetEnd = input.arrayScopeOffsetEnd;

            cellsState = new CellsState(input.xLen, input.yLen, input.sharedBuffer);
            cellsMachine = new CellsMachine(input.rules.b, input.rules.s);
            cellsRenderer = new CellsRenderer(input.cellSize, input.offscreen, input.canvasWidth, input.canvasScopeHeight, cellBitmap);

            break;
        case "<EVOLVE>":
            cellsMachine.evolve();
            break;
        case "<RENDER>":
            cellsRenderer.draw();
            break;
        case "<CHANGE-RULES>":
            cellsMachine = new CellsMachine(ev.data.input.rules.b, ev.data.input.rules.s);
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
self.addEventListener("message", (ev): Promise<void> => relay(ev));