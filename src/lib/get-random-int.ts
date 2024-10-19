export function getRandomInt(min: number, max: number): number {
    const randomBuffer: Uint32Array = new Uint32Array(1);
    crypto.getRandomValues(randomBuffer);

    // Convert the random value to a decimal between 0 and 1.
    let randomNumber: number = randomBuffer[0] / (0xffffffff + 1);

    const adjustedMin: number = Math.ceil(min);
    const adjustedMax: number = Math.floor(max);

    const randomRange: number = adjustedMax - adjustedMin + 1;
    const randomOffset: number = Math.floor(randomNumber * randomRange);

    return adjustedMin + randomOffset;
}