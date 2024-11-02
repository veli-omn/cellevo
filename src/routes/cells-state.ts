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