import { sleep } from "./sleep.js"


export class ScreenWakeLock {
    static wakeLock: null | WakeLockSentinel = null;
    static intervalID: undefined | number;
    static wakeLockInNavigator: boolean = false;
    static isOn: boolean = false;

    static {
        if (!("wakeLock" in navigator)) {
            console.debug("Screen Wake Lock: not supported");
        } else {
            this.wakeLockInNavigator = true;
        }
    }

    static async request(): Promise<void> {
        if (!this.wakeLockInNavigator) return;

        this.isOn = true;

        if (this.wakeLock === null || this.wakeLock?.released) {
            this.intervalID = setInterval(async () => {
                try {
                    await sleep(100);

                    if (document.visibilityState !== "hidden") {
                        this.wakeLock = await navigator.wakeLock.request("screen");
                        clearInterval(this.intervalID);

                        this.wakeLock.addEventListener("release", () => {
                            if (this.isOn) {
                                this.request();
                            }
                        }, { once: true });
                    }
                } catch (err) {
                    console.debug(`Screen Wake Lock: failed to acquire screen wake lock |`, err);
                }
            }, 4000);
        }
    }

    static async release(): Promise<void> {
        if (!this.wakeLockInNavigator) return;

        this.isOn = false;

        if ((this.wakeLock !== null) && !this.wakeLock?.released) {
            try {
                await this.wakeLock.release();
            } catch (err) {
                console.debug(`Screen Wake Lock: failed to release screen wake lock |`, err);
            }
        }
    }
}