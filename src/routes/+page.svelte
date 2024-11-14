<script lang="ts">
    import faviconURL from "./favicon.svg";
    import { onMount, onDestroy } from "svelte";
    import { SvelteSet } from "svelte/reactivity";
    import { HideCursorHandler } from "libjs/browser/hide-cursor-handler.js";
    import { ScreenWakeLock } from "libjs/browser/screen-wake-lock.js";
    import { range } from "libjs/generic/range.js";
    import { getRandomInt } from "libjs/generic/get-random-int.js";
    import { debounce } from "libjs/generic/debounce.js";
    import { createPrefixedLogger } from "libjs/generic/create-prefixed-logger.js";
    import { CellsState } from "./cells-state.js";
    import { InterscopeMap } from "libjs/browser/interscope-map.js";
    import type { MessageForm } from "$lib/types.ts";
    import type { Density, WorkerInitData, SnapshotData } from "./types.js";


    const cellevoLog = createPrefixedLogger("CELLEVO");
    const edgesBorderWidth: number = 1;
    const edgesBorderPadding: number = 6;
    let cellsState: CellsState = $state(new CellsState(0, 0));
    let cellSize: number;
    let cellPadding: number;
    let aliveCells: number = $state(0);
    let rules = $state({ b: new SvelteSet([3]), s: new SvelteSet([2, 3]) });
    let density: Density = $state("M");

    let innerWidth: number = $state(0);
    let canvasDOM: boolean = $state(false);
    let canvasVisible: boolean = $state(false);
    let hideCursorHandler: HideCursorHandler | null = null;

    // "-1" to ideally prevent spawning last worker in same thread as main.., 4 as universal for Apple...? (navigator.hardwareConcurrency not available on Apple).
    const threadsN: number = (navigator?.hardwareConcurrency >= 2 ? navigator.hardwareConcurrency : 4) - 1;
    const workersController = {
        count: <number> threadsN,
        pool: <Array<Worker>> [],
        waiting: <number> threadsN,
        listenersAC: <AbortController> new AbortController(),

        post(specificWorker: number, ...args: Array<unknown>): void {
            if (specificWorker > -1 && specificWorker < this.count) {
                this.pool[specificWorker].postMessage(...args as [unknown]);
                this.waiting--;
            } else {
                for (let i = 0; i < this.count; i++) {
                    this.pool[i].postMessage(...args as [unknown]);
                    this.waiting--;
                }
            }
        },

        relay(ev: MessageEvent<MessageForm>): void {
            switch (ev.data.type) {
                case "<WAITING-AFTER>":
                    this.waiting++;

                    if (this.waiting === this.count) {
                        switch (ev.data.input) {
                            case "<INIT>":
                                updateAliveCellsCount();
                                canvasVisible = true;
                                break;
                            case "<EVOLVE>":
                                cellsState.switchIndication();
                            case "<RANDOM>":
                            case "<CLEAR>":
                                this.post(-1, { type: "<RENDER>" });
                                break;
                            case "<RENDER>":
                            case "<CHANGE-RULES>":
                                loop.continue();
                        }
                    }

                    break;
                case "<ERROR>":
                    cellevoLog("error", ev.data.input);
                    break;
                default:
                    cellevoLog("error", `received unknown type of message from worker: ${JSON.stringify(ev.data)}`);
            }
        },

        terminate(): void {
            this.listenersAC.abort();

            for (let i = 0; i < this.count; i++) {
                this.pool[i].terminate();
            }
        }
    };

    for (let i = 0; i < workersController.count; i++) {
        const worker: Worker = new Worker(new URL("./worker.ts", import.meta.url), {  type: "module" });

        worker.addEventListener("error", (ev: ErrorEvent): void => cellevoLog("error", `worker[${i}/${workersController.count}] failure | ${ev.message}`), { signal: workersController.listenersAC.signal });
        worker.addEventListener("message", (ev: MessageEvent): void => workersController.relay(ev), { signal: workersController.listenersAC.signal });
        workersController.pool[i] = worker;
    }


    function initBackground(canvas: HTMLCanvasElement, canvasWidth: number, canvasHeight: number): void {
        const ctx: CanvasRenderingContext2D = canvas.getContext("2d")!;
        const edgeBorderLen: number = Math.round((canvasWidth < canvasHeight ? canvasWidth : canvasHeight) * 0.4);

        canvas.width = canvasWidth + edgesBorderWidth + edgesBorderPadding;
        canvas.height = canvasHeight + edgesBorderWidth + edgesBorderPadding;
        ctx.lineWidth = edgesBorderWidth;

        const edgesCoordinates = [
            [[0, 0], [0, edgeBorderLen], [edgeBorderLen, 0]],
            [[0, canvas.height], [0, canvas.height - edgeBorderLen], [edgeBorderLen, canvas.height]],
            [[canvas.width, canvas.height], [canvas.width - edgeBorderLen, canvas.height], [canvas.width, canvas.height - edgeBorderLen]],
            [[canvas.width, 0], [canvas.width - edgeBorderLen, 0], [canvas.width, edgeBorderLen]]
        ];

        for (const edge of edgesCoordinates) {
            const [x0, y0] = edge[0];
            const drawLine = (x: number, y: number): void => {
                const gradient: CanvasGradient = ctx.createLinearGradient(x0, y0, x, y);

                gradient.addColorStop(0.1, "#ff79316d");
                gradient.addColorStop(1, "#00000000");
                ctx.strokeStyle = gradient;

                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(x, y);
                ctx.stroke();
            }

            drawLine(edge[1][0], edge[1][1]);
            drawLine(edge[2][0], edge[2][1]);
        }
    }


    function initMatrix(node: HTMLElement): void {
        cellSize = density === "U" ? 1 : density === "H" ? 3 : density === "M" ? 5 : 9;
        cellPadding = density === "U" ? 0 : density === "H" ? 0.08 : density === "M" ? 0.3 : 0.8;

        const xLen: number = Math.trunc((node.parentElement!.offsetWidth - edgesBorderWidth - edgesBorderPadding - 2) / cellSize);
        const yLen: number = Math.trunc((node.parentElement!.offsetHeight - edgesBorderWidth - edgesBorderPadding - 2) / cellSize);

        const canvasWidth: number = xLen * cellSize;
        const canvasHeight: number = yLen * cellSize;

        initBackground(node.previousElementSibling as HTMLCanvasElement, canvasWidth, canvasHeight);

        // This keeps the cells state, if there is no delta between last and current matrix dimensions.
        if ((xLen !== cellsState.xLen) || (yLen !== cellsState.yLen)) {
            cellsState = new CellsState(xLen, yLen);
        } else {
            // Renderer draws cell only if there is delta against the last state array,
            // so we need to enforce the delta to be able to re-render it.
            // Since all logic uses only 0 and 1 to represent the cell state,
            // filling the last state array with for example 2, ensures there will be delta.
            cellsState.lastStateArray.fill(2);
        }

        let arrayScopePool: number = 0;
        for (let i = 0; i < workersController.count; i++) {
            const matrixCanvas: HTMLCanvasElement = node.children[i] as HTMLCanvasElement;
            const offscreen: OffscreenCanvas = matrixCanvas.transferControlToOffscreen();
            const arrayScopeYLen: number = Math.floor(yLen / workersController.count) + (i < yLen % workersController.count ? 1 : 0);

            const data: WorkerInitData = {
                type: "<INIT>",
                input: {
                    xLen,
                    yLen,
                    cellSize,
                    cellPadding,
                    rules: $state.snapshot(rules),
                    sharedBuffer: cellsState.sharedBuffer,
                    offscreen,
                    arrayScopeOffsetStart: arrayScopePool,
                    arrayScopeOffsetEnd: arrayScopePool += (arrayScopeYLen * xLen),
                    canvasWidth,
                    canvasScopeHeight: arrayScopeYLen * cellSize
                }
            };

            workersController.post(i, data, [offscreen]);
        }
    }


    const showCanvasAction = (node: HTMLElement) => {
        try {
            initMatrix(node);
        } catch (err) {
            cellevoLog("error", `failed to initialize matrix | ${err}`);
        }
    };


    function updateAliveCellsCount(): void {
        let aliveN: number = 0;

        for (const cell of cellsState.getCurrent()) {
            if (cell === 1) {
                aliveN++;
            }
        }

        aliveCells = aliveN;
    }


    const loop = $state({
        running: <boolean> false,
        timerID: <number> 0,
        lastRunTime: <number> 0,

        run(): void {
            if (this.running) {
                this.lastRunTime = performance.now();
                workersController.post(-1, { type: "<EVOLVE>" });
            }
        },

        switchEffect: debounce(async () => {
            if (loop.running) {
                await ScreenWakeLock.request();

                if (hideCursorHandler === null) {
                    hideCursorHandler = new HideCursorHandler(document.body);
                }
            } else {
                await ScreenWakeLock.release();

                if (hideCursorHandler !== null) {
                    hideCursorHandler.remove();
                    hideCursorHandler = null;
                }
            }
        }, 1800),

        switch(): void {
            this.running = !this.running;

            this.run();

            if (!this.running) updateAliveCellsCount();

            this.switchEffect.execute();
        },

        continue(): void {
            if (this.running) {
                const timeDeltaFromLast: number = performance.now() - this.lastRunTime;
                const timeMS: number = (1000 / frequencyController.value) - timeDeltaFromLast;

                clearTimeout(this.timerID);
                this.timerID = setTimeout((): void => this.run(), timeMS > 0 ? timeMS : 0);
            } else {
                updateAliveCellsCount();
            }
        }
    });


    const frequencyController = $state({
        value: <number> 1,
        max: <number> 300,
        buttonHzIsDown: <boolean> false,
        buttonHzIsDownLongTimer: <number> 0,
        bigIncrementSize: <number> 30,

        change(increment: boolean): void {
            const performChange = (increment: boolean, longPress?: boolean) => {
                if (increment && this.value < this.max) {
                    this.value++;
                } else if (this.value !== 1) {
                    this.value--;
                }

                if (this.buttonHzIsDown && longPress && this.value !== 1 && this.value !== this.max) {
                    setTimeout((): void => performChange(increment, longPress), 70);
                }

                loop.run();
            };

            this.buttonHzIsDown = true;
            performChange(increment);

            if (this.value !== 1 && this.value !== this.max) {
                this.buttonHzIsDownLongTimer = setTimeout((): void => performChange(increment, true), 460);
            }

            document.body.addEventListener("mouseup", (): void => {
                clearTimeout(this.buttonHzIsDownLongTimer);
                this.buttonHzIsDown = false;
            }, { once: true });
        },

        bigIncrement(): void {
            if (this.value < this.max - this.bigIncrementSize) {
                if (this.value === 1) {
                    this.value += this.bigIncrementSize - 1;
                } else {
                    this.value += this.bigIncrementSize;
                }
            } else if (this.value !== this.max) {
                this.value = this.max;
            } else {
                this.value = 1;
            }

            loop.run();
        }
    });


    const debouncedShowCanvas: ReturnType<typeof debounce> = debounce((): boolean => canvasDOM = true, 400);

    function resizeHandler(): void {
        if (canvasDOM) {
            canvasDOM = false;
            canvasVisible = false;
        }

        if (loop.running) {
            loop.switch();
        }

        debouncedShowCanvas.execute();
    }


    function switchCell(event: MouseEvent): void {
        const target: HTMLElement = event.currentTarget as HTMLElement;
        const rect: DOMRect = target.getBoundingClientRect();
        const mouseX: number = event.clientX - rect.left;
        const mouseY: number = event.clientY - rect.top;

        const caclulatedColumn: number = Math.floor(mouseX / cellSize);
        const caclulatedRow: number = Math.floor(mouseY / cellSize);

        const column: number | null = (caclulatedColumn >= 0) && (caclulatedColumn <= cellsState.xLen - 1) ? caclulatedColumn : null;
        const row: number | null = (caclulatedRow >= 0) && (caclulatedRow <= cellsState.yLen - 1) ? caclulatedRow : null;

        if ((column === null) || (row === null)) return;

        const index: number = row * cellsState.xLen + column;
        const currentState: Uint8Array = cellsState.getCurrent();

        currentState[index] = currentState[index] === 0 ? 1 :  0;

        workersController.post(-1, { type: "<RENDER>" });
    }

    function switchRule(rule: string, num: number): void {
        if (rule === "b") {
            if (rules.b.has(num)) {
                rules.b.delete(num);
            } else {
                rules.b.add(num);
            }
        } else if (rule === "s") {
            if (rules.s.has(num)) {
                rules.s.delete(num);
            } else {
                rules.s.add(num);
            }
        }

        workersController.post(-1, { type: "<CHANGE-RULES>", input: { rules: $state.snapshot(rules) } });
    }

    function setDensity(level: Density): void {
        if (level !== density) {
            density = level;
            resizeHandler();
        }
    }

    const setDefaultDensity = (): Density => density = innerWidth > 640 ? "M" : "H";

    function random(): void {
        const numOfPasses: number = getRandomInt(1, 8);

        if (workersController.count >= numOfPasses) {
            for (let i = 0; i < numOfPasses; i++) {
                workersController.post(i, { type: "<RANDOM>", input: 1 });
            }
        } else {
            workersController.post(-1, { type: "<RANDOM>", input: Math.floor(numOfPasses / workersController.count) });
        }
    }

    function clear(): void {
        workersController.post(-1, { type: "<CLEAR>" });
    }

    function reset(): void {
        rules.b = new SvelteSet([3]);
        rules.s = new SvelteSet([2, 3]);
        frequencyController.value = 1;
        setDefaultDensity();
        resizeHandler();
    }


    function keyHandler(ev: KeyboardEvent): void {
        if (!canvasVisible) return;

        switch (ev.key) {
            case " ":
                loop.switch();
                break;
            case "r":
                random();
                break;
            case "c":
                workersController.post(-1, { type: "<CLEAR>" });
                break;
            case "f":
                frequencyController.bigIncrement();
        }

        for (let i = 0; i <= 8; i++) {
            if (ev.key === i.toString()) {
                !ev.altKey ? switchRule("b", i) : switchRule("s", i);
            }
        }
    }


    const snapshot = {
        mapKey: <string> "CELLEVO_snapshot",

        async create(): Promise<void> {
            await InterscopeMap.set(this.mapKey, {
                xLen: cellsState.xLen,
                yLen: cellsState.yLen,
                bufferState: new Uint8Array(new Uint8Array(cellsState.sharedBuffer)),
                rules: $state.snapshot(rules),
                frequency: frequencyController.value,
                density
            } as SnapshotData);
        },

        async restore(): Promise<boolean> {
            const data = <SnapshotData> await InterscopeMap.get(this.mapKey);

            if (data) {
                cellsState = new CellsState(data.xLen, data.yLen);
                new Uint8Array(cellsState.sharedBuffer).set(data.bufferState);
                frequencyController.value = data.frequency;
                rules.b = new SvelteSet(data.rules.b);
                rules.s = new SvelteSet(data.rules.s);
                density = data.density;
            }

            return data ? true : false;
        }
    };


	onMount(async (): Promise<void> => {
        if (!await snapshot.restore()) {
            setDefaultDensity();
        }

        canvasDOM = true;
	});

    onDestroy(async (): Promise<void> => {
        if (hideCursorHandler !== null) {
            hideCursorHandler.remove();
        }

        clearTimeout(loop.timerID);
        workersController.terminate();
        loop.switchEffect.clear();
        debouncedShowCanvas.clear();

        await ScreenWakeLock.release();
        await snapshot.create();
    });
</script>


<svelte:head>
    <title>Cellevo</title>
    <link rel="icon" type="image/svg+xml" href={faviconURL}/>
    <meta name="description" content="CA, GOL">
    <meta name="keywords" content="cellevo, celluar automata, project">
</svelte:head>

<svelte:window bind:innerWidth onresize={resizeHandler} onbeforeunload={() => snapshot.create()}/>

<svelte:document
    onfullscreenchange={resizeHandler}
    onkeydown={keyHandler}
    onvisibilitychange={() => document.visibilityState === "hidden" && snapshot.create()}
/>


<article class="po-ab fl-ce m-f" inert={!canvasVisible}>
    <h1 style="display: none;">Cellevo</h1>
    <div id="stats" class="light" class:invis={loop.running || !canvasVisible} title={`${aliveCells} Alive Cell${aliveCells !== 1 ? "s" : ""} out of ${cellsState.xLen * cellsState.yLen} (${cellsState.xLen} x ${cellsState.yLen})`}>
        <span>{aliveCells}</span>
        <span>:</span>
        <span>{cellsState.xLen * cellsState.yLen}</span>
    </div>
    <div id="matrix-render">
        {#if canvasDOM}
            <canvas></canvas>
            <div use:showCanvasAction onmousedown={(ev) => switchCell(ev)} class:invis={!canvasVisible} role="gridcell" tabindex="-1">
                {#each workersController.pool as _}
                    <canvas></canvas>
                {/each}
            </div>
        {/if}
    </div>
    <div id="controll">
        <div id="input-field">
            <div>
                <div title="Born Rules">
                    <span class="light symbol">B</span>
                    {#each range(0, 8) as i}
                        <button type="button" onmousedown={() => switchRule("b", i)} class:active-button={rules.b.has(i)} tabindex="-1">
                            {i}
                        </button>
                    {/each}
                </div>
                <div title="Survive Rules">
                    <span class="light symbol">S</span>
                    {#each range(0, 8) as i}
                        <button type="button" onmousedown={() => switchRule("s", i)} class:active-button={rules.s.has(i)} tabindex="-1">
                            {i}
                        </button>
                    {/each}
                </div>
            </div>
            <div>
                <div class="light" title="Frequency">
                    <button onmousedown={() => frequencyController.bigIncrement()} class="light symbol" tabindex="-1">f</button>
                    <button type="button" onmousedown={() => frequencyController.change(false)} disabled={frequencyController.value <= 1} tabindex="-1">«</button>
                    <span id="hz-indication">
                        <span>{frequencyController.value}</span>
                        <span>Hz</span>
                    </span>
                    <button type="button" onmousedown={() => frequencyController.change(true)} disabled={frequencyController.value >= frequencyController.max} tabindex="-1">»</button>
                </div>
                <div title="Density: Low | Middle | High | Ultra">
                    <span class="light symbol">ρ</span>
                    <button type="button" onmousedown={() => setDensity("L")} class:active-button={density === "L"} tabindex="-1">L</button>
                    <span>|</span>
                    <button type="button" onmousedown={() => setDensity("M")} class:active-button={density === "M"} tabindex="-1">M</button>
                    <span>|</span>
                    <button type="button" onmousedown={() => setDensity("H")} class:active-button={density === "H"} tabindex="-1">H</button>
                    <span>|</span>
                    <button type="button" onmousedown={() => setDensity("U")} class:active-button={density === "U"} tabindex="-1">U</button>
                </div>
            </div>
            <div>
                <div title="Switch Iteration Status">
                    <button type="button" onmousedown={() => loop.switch()} class:active-button={loop.running} tabindex="-1">ON</button>
                    <span>|</span>
                    <button type="button" onmousedown={() => loop.switch()} class:active-button={!loop.running} tabindex="-1">OFF</button>
                </div>
                <button type="button" onmousedown={random} class="light" tabindex="-1" title="Randomly Switch Cells Status">
                    random
                </button>
                {#if aliveCells > 0 || loop.running}
                    <button type="button" onmousedown={() => clear()} class="light" tabindex="-1" title="Clear Alive Cells">
                        clear
                    </button>
                {:else}
                    <button type="button" onmousedown={() => reset()} class="light" tabindex="-1" title="Reset Parameters">
                        reset
                    </button>
                {/if}
            </div>
        </div>
    </div>
</article>


<style lang="scss">
    @use "sass:color";

    $color-primary: #ff7931; // rgb(255, 121, 49)
    $color-tertiary: color.change($color-primary, $alpha: 0.4);
    // $color-primary: #ff7931;
    // $color-primary: #ff0044;
    // $color-primary: #ff8605;
    // $color-primary: #ff2744;

    article {
        padding: 0.2em 0.6em;
        min-height: 15em;
    }

    #stats {
        display: flex;
        flex-direction: row nowrap;
        gap: 0.3em;
        font-size: 0.6em;
        font-weight: 900;
        filter: opacity(0.5) grayscale(0.3);
        text-align: center;
        margin-bottom: 0.2em;
        transition: 0.2s;

        span {
            &:first-of-type {
                text-align: right;
                width: 30vw;
            }

            &:last-of-type {
                text-align: left;
                width: 30vw;
            }
        }
    }

    #matrix-render {
        width: 100%;
        height: 100%;
        position: relative;
        transition: 0.2s background-color ease-out;
        filter: drop-shadow(0 0 0.3em $color-primary);
        overflow: hidden;
        display: flex;
        justify-content: center;
        align-items: center;

        canvas {
            animation: canvas-fade-in 1s ease-out forwards 0.1s;
            transition: 0.4s ease-out;
            filter: opacity(0) grayscale(0.3);
        }

        & > canvas {
            position: absolute;
        }

        & > div {
            display: flex;
            flex-flow: column nowrap;
            transition: 0.6s ease-out;
        }

        &:not(:global(:has(canvas))) {
            transition: 0.12s ease-out;
            background-color: color.change($color-primary, $alpha: 0.06);
        }
    }

    @keyframes canvas-fade-in {
        to {
            filter: opacity(1) grayscale(0);
        }
    }

    #controll {
        display: flex;
        flex-flow: column nowrap;
        justify-content: center;
        align-items: center;
        gap: 0.7em;
        font-size: 0.8em;
        font-weight: 600;
        transition: 8s filter ease-out 8s;
        margin: 0 auto;
        padding: 0.5em 1em 0.5em 1em;
        filter: opacity(0.5) grayscale(0.2);

        &:active {
            filter: opacity(1) grayscale(0);
            transition: 0.1s filter;
        }
    }

    #input-field {
        display: flex;
        flex-flow: column nowrap;
        justify-content: center;
        gap: 0.33em;
        color: $color-tertiary;

        > div {
            width: 100%;
            display: flex;
            flex-flow: row nowrap;
            align-items: center;
            justify-content: center;
            gap: 1.8em;

            &:nth-child(1) { // B and S parameters row.
                button {
                    &:not(&:last-of-type) {
                        margin-right: 0.5em;
                    }

                    &.active-button {
                        cursor: pointer;
                        pointer-events: all;
                    }
                }
            }

            &:nth-child(2) { // Frequency row.
                span {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    gap: 0.12em;
                    transition: 0.1s ease-out;
                }

                #hz-indication {
                    width: 3.2em;
                }
            }

            > div {
                display: flex;
                flex-flow: row nowrap;
                justify-content: center;
                align-items: center;
                gap: 0.2em;
            }
        }

        button {
            background: none;
            border: none;
            transition: 0.3s ease-out;

            &:active {
                transition: 0.1s ease-out;
                text-shadow: 0 0 0.42em $color-primary, 0 0 0.42em $color-primary;
            }
        }
    }

    .light {
        color: $color-primary;
        text-shadow: 0 0 0.12em $color-primary;
    }

    .active-button {
        color: $color-primary;
        text-shadow: 0 0 0.32em $color-primary;
        cursor: default;
        pointer-events: none;
    }

    button:disabled {
        color: $color-tertiary;
        cursor: default;
        pointer-events: none;
    }

    .symbol {
        font-style: italic;
        margin-right: 0.8em;
    }

    @media only screen and (max-width: 640px) {
        article {
            padding: 0.3em 0.6em;
        }

        #stats {
            margin: 0 auto 0.3em;
        }

        #controll {
            padding: 0.3em 0.2em;
        }

        #input-field {
            font-size: 1.28em;
            padding: 0.3em 0;
            gap: 0.72em;

            & > div {
                gap: 1em;

                &:nth-child(1) { // B and S parameters row.
                    flex-flow: column nowrap;
                    gap: 0.5em;
                }

                & > div {
                    gap: 0.1em;
                }
            }
        }
    }
</style>