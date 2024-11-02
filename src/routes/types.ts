export interface WorkerInitData {
    type: string;
    input: {
        xLen: number;
        yLen: number;
        cellSize: number;
        cellPadding: number;
        rules: {
            b: Set<number>;
            s: Set<number>;
        };
        sharedBuffer: SharedArrayBuffer;
        offscreen: OffscreenCanvas;
        arrayScopeOffsetStart: number;
        arrayScopeOffsetEnd: number;
        canvasWidth: number;
        canvasScopeHeight: number;
    };
}

export type Density = "L" | "M" | "H" | "U";

export interface SnapshotData {
    xLen: number;
    yLen: number;
    bufferState: Uint8Array;
    rules: WorkerInitData["input"]["rules"];
    frequency: number;
    density: Density;
}
