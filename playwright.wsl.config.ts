import base from './playwright.config'

/*
    A local-only override for running the browser suite inside WSL2.

    Launching Chromium with its default settings destroys the whole WSL virtual
    machine (`Wsl/Service/E_UNEXPECTED`), not just the browser process, so the
    suite has never been runnable on that machine. It is not a missing-library
    problem - the binary starts and prints its version fine, then the VM dies
    when a page renders.

    The cause is the GPU paravirtualisation path. WSLg is running and /dev/dxg
    is present, so Chromium takes the hardware GPU route by default, and that
    route crosses into the Windows GPU driver - the one layer where a guest
    process can take the host service down. Forcing software rendering keeps it
    inside the VM.

    Measured 2026-09-04: with these flags a page renders, a real screenshot is
    produced, and the VM survives. Without them, four attempts out of four
    killed it.

    Not part of the committed config on purpose - CI runs on Linux where the
    hardware path is fine and faster. Use it only on WSL:

        npx playwright test --config playwright.wsl.config.ts

    DISPLAY and WAYLAND_DISPLAY also need blanking in the environment, since
    they are what attaches Chromium to WSLg in the first place, and
    LD_LIBRARY_PATH has to point at the unpacked libraries because
    `playwright install-deps` needs root and `sudo -n` fails there.
*/
export default {
    ...base,
    use: {
        ...base.use,
        launchOptions: {
            args: [
                '--disable-gpu',
                '--use-gl=swiftshader',
                '--disable-software-rasterizer',
                '--no-sandbox',
                '--disable-dev-shm-usage',
            ],
        },
    },
}
