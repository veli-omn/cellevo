export interface WorkerInitData {
    type: string;
    input: {
        xLen: number;
        yLen: number;
        cellSize: number;
        rules: {
            b: Array<number>;
            s: Array<number>;
        };
        sharedBuffer: SharedArrayBuffer;
        offscreen: OffscreenCanvas;
        arrayScopeOffsetStart: number;
        arrayScopeOffsetEnd: number;
        canvasWidth: number;
        canvasScopeHeight: number;
        cellImageDataArray: Uint8ClampedArray;
    };
}

export interface MessageForm {
    type: string;
    input?: any;
}