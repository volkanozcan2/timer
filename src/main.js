import './style.css'

// --- Globals ---
let countdownInterval;
let starfieldCanvas;
let ctx;
let stars = [];
const NUM_STARS = 100; // Yıldız sayısı önemli ölçüde azaltıldı
let isStarfieldVisible = true;
let animationFrameId;
let serverTimeOffset = 0; // Offset in ms (Server Time - Local Time)
let showClock = false; // Toggle between countdown and clock
let clockInterval; // Interval for updating clock when countdown is not active

// Starfield Constants for 3D Projection
const FOCAL_LENGTH = 500; // Daha yüksek odak uzaklığı
const MAX_Z = FOCAL_LENGTH + 250;

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

class Star {
    constructor() {
        this.reset();
    }

    // Initialize star with 3D coordinates (x, y, z)
    reset() {
        // Generate X and Y coordinates relative to the center (0, 0)
        this.x3D = (Math.random() - 0.5) * starfieldCanvas.width * 2;
        this.y3D = (Math.random() - 0.5) * starfieldCanvas.height * 2;
        // Start far away
        this.z = Math.random() * MAX_Z; // Start at random Z to populate the tunnel
        this.baseSpeed = Math.random() * 1.5 + 2; // Hız daha da azaltıldı
    }

    // Calculate 2D screen coordinates using perspective projection
    project() {
        // Calculate 2D position based on Z-depth (closer stars are further from center)
        const scale = FOCAL_LENGTH / this.z;
        this.screenX = this.x3D * scale + starfieldCanvas.width / 2;
        this.screenY = this.y3D * scale + starfieldCanvas.height / 2;
        this.radius = Math.max(0.1, 1.5 * scale); // Yıldız boyutu daha da küçültüldü (0.1 minimum)
        this.opacity = Math.min(1.0, 1.0 - (this.z / MAX_Z)); // Fade in as it approaches
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.screenX, this.screenY, this.radius, 0, Math.PI * 2);
        // Use a subtle white color
        ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
        ctx.fill();
    }

    update(deltaTime) {
        // Move star closer to the camera (decrease Z)
        this.z -= this.baseSpeed * (deltaTime / 16); // Normalize speed

        // If star has passed the camera or is out of view, reset it to the far distance
        if (this.z <= 1 ||
            this.screenX < 0 || this.screenX > starfieldCanvas.width ||
            this.screenY < 0 || this.screenY > starfieldCanvas.height) {
            this.reset();
        }

        this.project();
    }
}

function initStarfield() {
    starfieldCanvas = document.getElementById('starfield');
    ctx = starfieldCanvas.getContext('2d');
    resizeCanvas();

    // Populate stars array
    for (let i = 0; i < NUM_STARS; i++) {
        stars.push(new Star());
    }

    window.addEventListener('resize', resizeCanvas);
    // Initial projection of all stars
    stars.forEach(star => star.project());
    starfieldLoop(); // Start the animation loop
}

function resizeCanvas() {
    // Update canvas dimensions to match viewport
    starfieldCanvas.width = window.innerWidth;
    starfieldCanvas.height = window.innerHeight;
    // Reproject stars to the new center
    stars.forEach(star => star.project());
}

let lastTime = 0;
function starfieldLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;

    // Clear the canvas with a very low transparent overlay for minimal motion blur
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)'; // Çok düşük trail/hareket bulanıklığı için
    ctx.fillRect(0, 0, starfieldCanvas.width, starfieldCanvas.height);

    stars.forEach(star => {
        star.update(deltaTime);
        star.draw();
    });

    animationFrameId = requestAnimationFrame(starfieldLoop);
}

function toggleStarfield(event) {
    // Only toggle if the star toggle button is clicked
    // Note: The global listener is removed, this is now bound to the button
    isStarfieldVisible = !isStarfieldVisible;

    if (isStarfieldVisible) {
        starfieldCanvas.style.opacity = '1';
        if (!animationFrameId) {
            lastTime = 0; // Reset time to avoid huge delta
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


// --- Countdown Core Logic ---

function updateCountdown(targetDate) {
    const now = new Date(Date.now() + serverTimeOffset);
    let timeDiff = targetDate.getTime() - now.getTime();

    if (timeDiff <= 0) {
        // Countdown finished!
        clearInterval(countdownInterval);
        timerDisplay.textContent = "Zaman doldu";

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

    // Unlock audio on user interaction (mobile/browser policy)
    alarmAudio.play().then(() => {
        alarmAudio.pause();
        alarmAudio.currentTime = 0;
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
    // Initialize the starfield animation
    initStarfield();

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
