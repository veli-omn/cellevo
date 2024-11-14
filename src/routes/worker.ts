import { CellsState } from "./cells-state.js";
import { getRandomBit } from "libjs/generic/get-random-bit.js";
import { getRandomInt } from "libjs/generic/get-random-int.js";
import { getTwoPointsDist } from "libjs/generic/get-two-points-dist.js";

import type { MessageForm } from "$lib/types.ts";
import type { WorkerInitData } from "./types.js";


let arrayScopeOffsetStart: number;
let arrayScopeOffsetEnd: number;

let cellsState: CellsState;
let cellsMachine: CellsMachine;
let cellsRenderer: CellsRenderer;


class CellsMachine  {
    bRules: Set<number>;
    sRules: Set<number>;

    constructor(bRules: Set<number>, sRules: Set<number>) {
        this.bRules = bRules;
        this.sRules = sRules;
    }

    random(passes: number): void {
        for (let i = 0; i < passes; i++) {
            const currentState: Uint8Array = cellsState.getCurrent();
            const centerCol: number = getRandomInt(0, cellsState.xLen);
            const centerRow: number = getRandomInt(0, cellsState.yLen);
            const radius: number = getRandomInt(2, (cellsState.xLen < cellsState.yLen ? cellsState.xLen : cellsState.yLen) * 0.1)

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
        const currentState: Uint8Array = cellsState.getCurrent();
        const nextState: Uint8Array = cellsState.getNext();

        for (let index = arrayScopeOffsetStart; index < arrayScopeOffsetEnd; index++) {
            const x: number = index % cellsState.xLen;
            const y: number = Math.floor(index / cellsState.xLen);
            const isAlive: boolean = currentState[index] === 1;
            let aliveNeighbors: number = 0;

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;

                    const nx: number = (x + dx + cellsState.xLen) % cellsState.xLen;
                    const ny: number = (y + dy + cellsState.yLen) % cellsState.yLen;

                    if (currentState[ny * cellsState.xLen + nx] === 1) aliveNeighbors++;
                }
            }

            if (!isAlive && this.bRules.has(aliveNeighbors)) {
                nextState[index] = 1;
            } else if (isAlive && this.sRules.has(aliveNeighbors)) {
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
    cellIData: ImageData;

    constructor(cellSize: number, offscreen: OffscreenCanvas, width: number, height: number, cellIData: ImageData) {
        this.cellSize = cellSize;
        this.canvas = offscreen;
        this.ctx = offscreen.getContext("2d", { willReadFrequently: true })!;
        this.canvas.width = width;
        this.canvas.height = height;
        this.cellIData = cellIData;
    }

    draw(): void {
        for (let index = arrayScopeOffsetStart; index < arrayScopeOffsetEnd; index++) {
            const x: number = (index - arrayScopeOffsetStart) % cellsState.xLen;
            const y: number = Math.floor((index - arrayScopeOffsetStart) / cellsState.xLen);
            const valueAtCurrentIndex: number = cellsState.getCurrent()[index];

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
        const x: number = col * this.cellSize;
        const y: number = row * this.cellSize;

        this.ctx.putImageData(this.cellIData, x, y);
    }

    clearCell(col: number, row: number): void {
        const x: number = col * this.cellSize;
        const y: number = row * this.cellSize;

        this.ctx.clearRect(x, y, this.cellSize, this.cellSize);
    }
}


function genCircleImageData(size: number, padding: number = 0, color: string = "#ff8131"): ImageData {
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

    return ctx.getImageData(0, 0, size, size);
}


async function relay(ev: MessageEvent<MessageForm>): Promise<void> {
    switch (ev.data.type) {
        case "<INIT>":
            const input: WorkerInitData["input"] = ev.data.input;
            const cellIData: ImageData = genCircleImageData(input.cellSize, input.cellPadding);

            arrayScopeOffsetStart = input.arrayScopeOffsetStart;
            arrayScopeOffsetEnd = input.arrayScopeOffsetEnd;

            cellsState = new CellsState(input.xLen, input.yLen, input.sharedBuffer);
            cellsMachine = new CellsMachine(input.rules.b, input.rules.s);
            cellsRenderer = new CellsRenderer(input.cellSize, input.offscreen, input.canvasWidth, input.canvasScopeHeight, cellIData);

            cellsRenderer.draw();

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