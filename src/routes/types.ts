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