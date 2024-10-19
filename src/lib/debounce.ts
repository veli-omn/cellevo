export function debounce(fn: Function, delay: number): { execute: (...args: Array<unknown>) => void, clear: () => void } {
    let timer: number;

    const execute = (...args: Array<unknown>): void => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };

    const clear = (): void => clearTimeout(timer);

    return { execute, clear };
}