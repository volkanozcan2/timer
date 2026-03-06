import './style.css'

// --- Globals ---
let countdownInterval;
let starfieldCanvas;
let gl;
let starProgram;
let starVertexBuffer;
let uTimeLocation;
let uResolutionLocation;
let isStarfieldVisible = true;
let animationFrameId;
let lastFrameTime = 0;
let shaderTime = 0;
let serverTimeOffset = 0; // Offset in ms (Server Time - Local Time)
let showClock = false; // Toggle between countdown and clock
let clockInterval; // Interval for updating clock when countdown is not active
let userStarSpeed = 0.12;
let mappedStarSpeed = 0.12;
let isSpeedDragActive = false;
let countdownStartMs = null;
let countdownEndMs = null;

const STAR_SPEED_MIN = 0.12;
const STAR_SPEED_MAX = 0.9;
const COUNTDOWN_SPEED_END_CAP = 0.985;

// --- DOM Elements ---
const timerDisplay = document.getElementById('timer-display');
const statusLabel = document.getElementById('status-label');
const targetTimeInput = document.getElementById('target-time');
const startButton = document.getElementById('start-button');
const controlsContainer = document.getElementById('controls');
const messageBox = document.getElementById('message-box');
let alarmAudio = new Audio('/alarm.mp3'); // Preload audio object

// --- Utility Functions ---

/**
 * Shows a temporary message in the custom message box.
 * @param {string} msg 
 */
function showMessage(msg, isError = true) {
    messageBox.textContent = msg;
    messageBox.classList.remove('opacity-0', 'bg-red-700', 'bg-green-700');

    if (isError) {
        messageBox.classList.add('bg-red-700');
    } else {
        messageBox.classList.add('bg-green-700');
    }

    messageBox.classList.add('opacity-100');
    setTimeout(() => {
        messageBox.classList.remove('opacity-100');
        messageBox.classList.add('opacity-0');
    }, 3000);
}

/**
 * Formats milliseconds into HH:MM:SS string.
 * @param {number} ms 
 */
function formatTime(ms) {
    if (ms < 0) return "00:00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

/**
 * Fetches current time from worldtimeapi.org for Europe/Istanbul
 * and calculates the offset from local time.
 */
async function syncTime() {
    try {
        const response = await fetch('https://worldtimeapi.org/api/timezone/Europe/Istanbul');
        const data = await response.json();
        const serverTime = new Date(data.datetime).getTime();
        const localTime = Date.now();
        serverTimeOffset = serverTime - localTime;
        console.log("Time synced. Offset:", serverTimeOffset, "ms");
    } catch (error) {
        console.error("Failed to sync time:", error);
        // Fallback to local time (offset 0) is automatic
    }
}

async function revealAppShell() {
    const root = document.documentElement;
    if (root.classList.contains('app-ready')) return;

    const reveal = () => {
        root.classList.remove('app-booting');
        root.classList.add('app-ready');
    };

    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    const pageLoaded = new Promise(resolve => {
        if (document.readyState === 'complete') {
            resolve();
            return;
        }
        window.addEventListener('load', () => resolve(), { once: true });
    });
    const safetyTimeout = new Promise(resolve => setTimeout(resolve, 3000));

    try {
        await Promise.race([Promise.all([fontsReady, pageLoaded]), safetyTimeout]);
    } catch {
        // Ignore and reveal anyway.
    }

    requestAnimationFrame(reveal);
}

const STARFIELD_VERTEX_SHADER = `
attribute vec2 aPosition;
void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const STARFIELD_FRAGMENT_SHADER = `
precision highp float;

uniform vec2 uResolution;
uniform float uTime;

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.x;
    p.y *= uResolution.y / uResolution.x;

    float time = uTime;

    float t = atan(p.x, p.y) * 48.0;
    float r = length(p);
    float h = fract(sin(floor(t) * 8.0) * 9.0);
    float o = h * 9.0 + time;
    float c = floor(h / max(r, 0.0008) + o) + 0.5 - o;

    vec2 s;
    s.x = (h / c) - r;
    s.y = (fract(t) - 0.5) * h * r;

    float star = (1.0 - length(s) * 400.0) / (c * c);
    star = max(star, 0.0);

    // Slight cyan tint so it reads better as a full-page background.
    vec3 color = vec3(star) * vec3(0.7, 0.9, 1.15);
    float vignette = smoothstep(1.25, 0.1, length(p));
    color *= vignette;

    gl_FragColor = vec4(color, 1.0);
}
`;

function createShader(glContext, type, source) {
    const shader = glContext.createShader(type);
    if (!shader) return null;
    glContext.shaderSource(shader, source);
    glContext.compileShader(shader);

    if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
        console.error("Shader compile error:", glContext.getShaderInfoLog(shader));
        glContext.deleteShader(shader);
        return null;
    }

    return shader;
}

function createProgram(glContext, vertexSource, fragmentSource) {
    const vertexShader = createShader(glContext, glContext.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(glContext, glContext.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return null;

    const program = glContext.createProgram();
    if (!program) return null;

    glContext.attachShader(program, vertexShader);
    glContext.attachShader(program, fragmentShader);
    glContext.linkProgram(program);
    glContext.deleteShader(vertexShader);
    glContext.deleteShader(fragmentShader);

    if (!glContext.getProgramParameter(program, glContext.LINK_STATUS)) {
        console.error("Program link error:", glContext.getProgramInfoLog(program));
        glContext.deleteProgram(program);
        return null;
    }

    return program;
}

function initStarfield() {
    starfieldCanvas = document.getElementById('starfield');
    if (!starfieldCanvas) return;

    gl = starfieldCanvas.getContext('webgl', { antialias: true, alpha: false });
    if (!gl) {
        console.error("WebGL not supported in this browser.");
        return;
    }

    starProgram = createProgram(gl, STARFIELD_VERTEX_SHADER, STARFIELD_FRAGMENT_SHADER);
    if (!starProgram) return;

    const aPositionLocation = gl.getAttribLocation(starProgram, 'aPosition');
    uTimeLocation = gl.getUniformLocation(starProgram, 'uTime');
    uResolutionLocation = gl.getUniformLocation(starProgram, 'uResolution');

    starVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, starVertexBuffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
            -1, -1,
            3, -1,
            -1, 3
        ]),
        gl.STATIC_DRAW
    );

    gl.useProgram(starProgram);
    gl.enableVertexAttribArray(aPositionLocation);
    gl.vertexAttribPointer(aPositionLocation, 2, gl.FLOAT, false, 0, 0);

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    lastFrameTime = 0;
    shaderTime = 0;
    animationFrameId = requestAnimationFrame(starfieldLoop);
}

function resizeCanvas() {
    if (!starfieldCanvas || !gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    starfieldCanvas.width = Math.floor(window.innerWidth * dpr);
    starfieldCanvas.height = Math.floor(window.innerHeight * dpr);
    starfieldCanvas.style.width = '100vw';
    starfieldCanvas.style.height = '100vh';
    gl.viewport(0, 0, starfieldCanvas.width, starfieldCanvas.height);
}

function starfieldLoop(timestamp) {
    if (!gl || !starProgram) return;
    if (!lastFrameTime) lastFrameTime = timestamp;
    const deltaTime = Math.min((timestamp - lastFrameTime) / 1000, 0.05);
    lastFrameTime = timestamp;

    let targetStarSpeed = mappedStarSpeed;
    if (countdownStartMs !== null && countdownEndMs !== null && countdownEndMs > countdownStartMs) {
        const nowMs = Date.now() + serverTimeOffset;
        const progressRaw = (nowMs - countdownStartMs) / (countdownEndMs - countdownStartMs);
        const progress = clamp(progressRaw, 0, COUNTDOWN_SPEED_END_CAP);
        targetStarSpeed = STAR_SPEED_MIN + (mappedStarSpeed - STAR_SPEED_MIN) * progress;
    }

    // Smoothly approach requested speed to avoid visual jumps.
    const smoothFactor = 1.0 - Math.exp(-12.0 * deltaTime);
    userStarSpeed += (targetStarSpeed - userStarSpeed) * smoothFactor;
    shaderTime += deltaTime * userStarSpeed;

    gl.useProgram(starProgram);
    gl.uniform1f(uTimeLocation, shaderTime);
    gl.uniform2f(uResolutionLocation, starfieldCanvas.width, starfieldCanvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    animationFrameId = requestAnimationFrame(starfieldLoop);
}

function toggleStarfield() {
    isStarfieldVisible = !isStarfieldVisible;

    if (isStarfieldVisible) {
        starfieldCanvas.style.opacity = '1';
        if (!animationFrameId && gl) {
            lastFrameTime = 0;
            animationFrameId = requestAnimationFrame(starfieldLoop);
        }
    } else {
        starfieldCanvas.style.opacity = '0';
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }
}

function toggleTimeDisplay() {
    showClock = !showClock;

    // If countdown is NOT running, we need to manually update the display
    // If countdown IS running, updateCountdown will handle it on next tick
    if (!countdownInterval) {
        if (showClock) {
            // Start a separate interval to update the clock
            if (clockInterval) clearInterval(clockInterval);
            const updateClock = () => {
                const now = new Date(Date.now() + serverTimeOffset);
                timerDisplay.textContent = formatTime(now.getTime() % (24 * 60 * 60 * 1000)); // Just HH:MM:SS
                // Actually formatTime takes ms, but formatTime logic is:
                // totalSeconds = ms / 1000.
                // hours = totalSeconds / 3600.
                // So passing Date.now() directly works if we want total hours since epoch? No.
                // formatTime expects duration in ms.
                // We need a formatClock function or adapt formatTime.
                // Let's make a simple clock formatter.
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');
                timerDisplay.textContent = `${hours}:${minutes}:${seconds}`;
            };
            updateClock(); // Run immediately
            clockInterval = setInterval(updateClock, 1000);
        } else {
            // Stop clock interval and reset display (or leave it as is? "00:00:00"?)
            if (clockInterval) clearInterval(clockInterval);
            timerDisplay.textContent = "00:00:00"; // Default state
        }
    } else {
        // Countdown is running, updateCountdown will pick up the change
        // But we might want to force an immediate update to avoid 1s lag
        // We can't easily call updateCountdown without targetDate.
        // It's fine, max 1s delay.
    }
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(e => {
            console.log(`Error attempting to enable fullscreen: ${e.message}`);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function setupHiddenSpeedControls() {
    const speedFromClientX = (clientX) => {
        const t = clamp(clientX / Math.max(window.innerWidth, 1), 0, 1);
        return STAR_SPEED_MIN + t * (STAR_SPEED_MAX - STAR_SPEED_MIN);
    };

    const onPointerDown = (event) => {
        if (event.clientY < window.innerHeight * 0.9) return;

        isSpeedDragActive = true;
        mappedStarSpeed = speedFromClientX(event.clientX);
    };

    const onPointerMove = (event) => {
        if (!isSpeedDragActive) return;
        // Absolute horizontal mapping while dragging in bottom zone.
        mappedStarSpeed = speedFromClientX(event.clientX);
    };

    const onPointerEnd = () => {
        isSpeedDragActive = false;
    };

    window.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerEnd, { passive: true });
    window.addEventListener('pointercancel', onPointerEnd, { passive: true });
}


// --- Countdown Core Logic ---

function updateCountdown(targetDate) {
    const now = new Date(Date.now() + serverTimeOffset);
    let timeDiff = targetDate.getTime() - now.getTime();

    if (timeDiff <= 0) {
        // Countdown finished!
        clearInterval(countdownInterval);
        countdownInterval = null;
        countdownStartMs = null;
        countdownEndMs = null;
        timerDisplay.textContent = "SÜRE BİTTİ";

        // Play alarm sound
        alarmAudio.play().catch(e => console.log("Audio play failed:", e));

        // Restore controls and normal display state
        controlsContainer.classList.remove('controls-hidden');
        statusLabel.textContent = ""; // Clear status text
        statusLabel.classList.remove('status-running'); // Restore status text margin
        timerDisplay.classList.remove('running-timer');
        startButton.textContent = "Geri Sayımı Yeniden Başlat"; // Update button text
        return;

    }

    if (showClock) {
        const currentNow = new Date(Date.now() + serverTimeOffset);
        const hours = String(currentNow.getHours()).padStart(2, '0');
        const minutes = String(currentNow.getMinutes()).padStart(2, '0');
        const seconds = String(currentNow.getSeconds()).padStart(2, '0');
        timerDisplay.textContent = `${hours}:${minutes}:${seconds}`;
    } else {
        timerDisplay.textContent = formatTime(timeDiff);
    }
}

function startCountdown() {
    const timeString = targetTimeInput.value;
    if (!timeString) {
        showMessage("Lütfen geçerli bir hedef zaman belirleyin.");
        return;
    }

    const [targetHour, targetMinute] = timeString.split(':').map(Number);

    const now = new Date(Date.now() + serverTimeOffset);
    let targetDate = new Date(Date.now() + serverTimeOffset);
    targetDate.setHours(targetHour, targetMinute, 0, 0);

    let timeDiff = targetDate.getTime() - now.getTime();

    // If the target time has already passed today, set it for tomorrow
    if (timeDiff <= 0) {
        targetDate.setDate(targetDate.getDate() + 1);
        timeDiff = targetDate.getTime() - now.getTime();
    }

    if (timeDiff <= 0) {
        showMessage("Zaman ayarlama hatası. Lütfen girişinizi kontrol edin.", true);
        return;
    }

    // Clear any existing interval
    if (countdownInterval) clearInterval(countdownInterval);
    countdownStartMs = now.getTime();
    countdownEndMs = targetDate.getTime();
    userStarSpeed = STAR_SPEED_MIN;

    // Unlock audio on user interaction (mobile/browser policy)
    // Mute it first so the user doesn't hear the "unlock" play
    alarmAudio.muted = true;
    alarmAudio.play().then(() => {
        alarmAudio.pause();
        alarmAudio.currentTime = 0;
        alarmAudio.muted = false; // Unmute for the actual alarm
    }).catch(e => console.log("Audio unlock failed:", e));

    // 1. Hide controls and collapse their space smoothly
    controlsContainer.classList.add('controls-hidden');

    // 2. Hide status label and collapse its space smoothly
    statusLabel.classList.add('status-running');

    // 3. Adjust timer size for the "running" state (easing handles the transition)
    timerDisplay.classList.add('running-timer');

    // 4. Clear status text content (was already removed from initial render)

    // Use a function that binds the targetDate
    const boundUpdate = () => updateCountdown(targetDate);

    // Run immediately and then every second
    boundUpdate();
    countdownInterval = setInterval(boundUpdate, 1000);
}


// --- Initialization ---
// window.onload is not ideal for modules, use DOMContentLoaded or just run it
document.addEventListener('DOMContentLoaded', () => {
    revealAppShell();

    // Initialize the starfield animation
    initStarfield();
    setupHiddenSpeedControls();

    // Sync time with server
    syncTime();

    // Load today's time plus 45 minutes as default suggestion
    const now = new Date();
    now.setMinutes(now.getMinutes() + 45);
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (targetTimeInput) targetTimeInput.value = defaultTime;

    // Add event listener to start the countdown
    if (startButton) startButton.addEventListener('click', startCountdown);

    // Add listener for star toggle button
    const starToggleBtn = document.getElementById('star-toggle');
    if (starToggleBtn) {
        starToggleBtn.addEventListener('click', toggleStarfield);
    }

    // Add listener for fullscreen toggle button
    const fullscreenToggleBtn = document.getElementById('fullscreen-toggle');
    if (fullscreenToggleBtn) {
        fullscreenToggleBtn.addEventListener('click', toggleFullscreen);
    }

    // Add listener for timer display toggle
    if (timerDisplay) {
        timerDisplay.style.cursor = 'pointer'; // Make it look clickable
        timerDisplay.addEventListener('click', toggleTimeDisplay);
    }
});
