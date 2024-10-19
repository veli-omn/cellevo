import { debounce } from "./debounce.js"


export class HideCursorHandler {
    node: HTMLElement;
    hideCursor: ReturnType<typeof debounce>;
    listenersAC: AbortController;
    initialCursor?: string;

    static eventsToListen: string[] = ["mousemove", "mousedown", "keydown"];

    constructor(node: HTMLElement, time: number = 2000) {
        this.node = node;
        this.listenersAC = new AbortController();

        this.hideCursor = debounce((): void => {
            this.initialCursor = node.style.cursor;
            this.node.style.cursor = "none";

            for (const event of HideCursorHandler.eventsToListen) {
                this.node?.addEventListener(event, (): void => this.revertCursor(), { once: true, signal: this.listenersAC.signal });
            }
        }, time);

        for (const event of HideCursorHandler.eventsToListen) {
            this.node?.addEventListener(event, (): void => this.hideCursor.execute(), { signal: this.listenersAC.signal });
        }

        this.hideCursor.execute();
    }

    revertCursor = (): void => {
        if ((typeof this.initialCursor === "string") && (this.node.style.cursor === "none")) {
            this.node.style.cursor = this.initialCursor;
        }
    }

    remove(): void {
        this.listenersAC.abort();
        this.hideCursor.clear();
        this.revertCursor();
    }
}
