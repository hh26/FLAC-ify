// DOM Elements
// Global Web Audio Framework Variables
let audioCtx = null;
let audioSource = null;
let analyser = null;

// Audio Enhancement Processing Nodes
let compressorNode = null;
let eqBassNode = null;
let eqMidNode = null;
let eqTrebleNode = null;
let pannerNode = null;

// DOM Control Element References
const btnOpen = document.getElementById('btn-open');
const trackList = document.getElementById('track-list');
const audioPlayer = document.getElementById('audio-player');
const nowPlayingText = document.getElementById('now-playing');
const nowArtistText = document.getElementById('now-artist');
const albumArt = document.getElementById('album-art');
const artPlaceholder = document.getElementById('art-placeholder');
const loadingText = document.getElementById('loading-text');
const lyricsContainer = document.getElementById('lyrics-container');
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');
const compressorToggle = document.getElementById('compressor-toggle');
const eqBassInput = document.getElementById('eq-bass');
const eqMidInput = document.getElementById('eq-mid');
const eqTrebleInput = document.getElementById('eq-treble');
const balanceInput = document.getElementById('audio-balance');
// Add these to your top list of DOM elements
const btnReset = document.getElementById('btn-reset');
const valBass = document.getElementById('val-bass');
const valMid = document.getElementById('val-mid');
const valTreble = document.getElementById('val-treble');
const valBalance = document.getElementById('val-balance');
const controlRack = document.getElementById('control-rack');
const rackTrigger = document.getElementById('rack-trigger');

// Data Management State Variables
let fileMap = new Map();
let parsedLyrics = []; 
let lastActiveIndex = -1; 
let savedFolderHandle = null; // 🚀 NEW: Keeps track of the loaded folder state

// 1. Initialize App & Register Service Worker (PWA)
window.addEventListener('load', async () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
    // Check cache, but DO NOT request permission yet
    const savedHandle = await idbKeyval.get('music-folder');
    if (savedHandle) {
        savedFolderHandle = savedHandle;
        btnOpen.textContent = "Unlock Saved Library"; // Update UI to prompt user click
        trackList.innerHTML = '<li class="empty-state">Saved library detected. Click "Unlock Saved Library" above to load your music.</li>';
    }
});

// Helper to query permission state
async function verifyPermission(fileHandle) {
    const options = { mode: 'read' };
    // First query silently to see if they already granted it this session
    if ((await fileHandle.queryPermission(options)) === 'granted') return true;
    // Request permission explicitly (this requires the user gesture to work)
    if ((await fileHandle.requestPermission(options)) === 'granted') return true;
    return false;
}

// 2. Main Button Click Event Listener (Handles both Picking and Unlocking)
btnOpen.addEventListener('click', async () => {
    try {
        let dirHandle = savedFolderHandle;

        // SCENARIO A: There is no saved folder, or user wants a brand new one
        if (!dirHandle) {
            dirHandle = await window.showDirectoryPicker();
            await idbKeyval.set('music-folder', dirHandle);
            savedFolderHandle = dirHandle;
        } else {
            // SCENARIO B: User is clicking to unlock their existing saved folder
            const permission = await verifyPermission(dirHandle);
            if (!permission) {
                // If they explicitly deny the pop-up, reset the button state to start over
                savedFolderHandle = null;
                btnOpen.textContent = "Select Music Folder";
                trackList.innerHTML = '<li class="empty-state">Permission denied.</li>';
                return;
            }
        }

        // Once folder is verified/selected successfully, change button to allow switching folders later
        btnOpen.textContent = "Change Music Folder";
        
        // Temporarily clear the saved state cache variable if they double-click to change it later
        btnOpen.ondblclick = async () => {
            await idbKeyval.del('music-folder');
            savedFolderHandle = null;
            btnOpen.textContent = "Select Music Folder";
            location.reload();
        };

        loadLibrary(dirHandle);

    } catch (err) {
        console.log('Folder selection or activation cancelled.', err);
    }
});

// Initialize the Master Routing Architecture Graph
function initWebAudio() {
    if (audioCtx) return; 

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioSource = audioCtx.createMediaElementSource(audioPlayer);
    analyser = audioCtx.createAnalyser();

    // 1. Configure the Dynamic Range Compressor (Auto Volume Leveler)
    compressorNode = audioCtx.createDynamicsCompressor();
    // Default mastering-grade settings:
    compressorNode.threshold.setValueAtTime(-24, audioCtx.currentTime);
    compressorNode.knee.setValueAtTime(30, audioCtx.currentTime);
    compressorNode.ratio.setValueAtTime(12, audioCtx.currentTime);
    compressorNode.attack.setValueAtTime(0.003, audioCtx.currentTime);
    compressorNode.release.setValueAtTime(0.25, audioCtx.currentTime);

    // 2. Configure the 3-Band Equalizer Filter Nodes
    eqBassNode = audioCtx.createBiquadFilter();
    eqBassNode.type = 'lowshelf';
    eqBassNode.frequency.value = 200; // Captures frequencies under 200Hz
    eqBassNode.gain.value = parseFloat(eqBassInput.value);

    eqMidNode = audioCtx.createBiquadFilter();
    eqMidNode.type = 'peaking';
    eqMidNode.Q.value = 1.0; 
    eqMidNode.frequency.value = 2500; // Targets standard vocal/instrument definitions
    eqMidNode.gain.value = parseFloat(eqMidInput.value);

    eqTrebleNode = audioCtx.createBiquadFilter();
    eqTrebleNode.type = 'highshelf';
    eqTrebleNode.frequency.value = 8000; // Air frequencies above 8kHz
    eqTrebleNode.gain.value = parseFloat(eqTrebleInput.value);

    // 3. Configure the Stereo Panner Node
    pannerNode = audioCtx.createStereoPanner();
    pannerNode.pan.value = parseFloat(balanceInput.value);

    // 4. Configure Visualizer Base Settings
    analyser.fftSize = 128;

    // 5. Connect the Connected Graph Chain Flow:
    // Source -> Equalizers (Bass -> Mid -> Treble) -> Panner -> Analyser -> Output
    // (Note: We branch the compressor selectively below)
    
    routeAudioPipeline();

    // Fire Up Visualizer Animation Loops
    drawVisualizer();
}

// Manually control routing to toggle compressor smoothly mid-track
function routeAudioPipeline() {
    if (!audioSource) return;

    // Disconnect everything to rebuild safely
    audioSource.disconnect();
    compressorNode.disconnect();
    eqBassNode.disconnect();
    eqMidNode.disconnect();
    eqTrebleNode.disconnect();
    pannerNode.disconnect();
    analyser.disconnect();

    // Assemble chain conditionally based on if leveler checkbox is checked
    if (compressorToggle.checked) {
        audioSource.connect(compressorNode);
        compressorNode.connect(eqBassNode);
    } else {
        audioSource.connect(eqBassNode);
    }

    // Connect remaining static mastering chain segments
    eqBassNode.connect(eqMidNode);
    eqMidNode.connect(eqTrebleNode);
    eqTrebleNode.connect(pannerNode);
    pannerNode.connect(analyser);
    analyser.connect(audioCtx.destination);
}

// Dynamic UI Labels Sync Updater Function
function updateControlLabels() {
    valBass.textContent = `${eqBassInput.value > 0 ? '+' : ''}${eqBassInput.value}dB`;
    valMid.textContent = `${eqMidInput.value > 0 ? '+' : ''}${eqMidInput.value}dB`;
    valTreble.textContent = `${eqTrebleInput.value > 0 ? '+' : ''}${eqTrebleInput.value}dB`;
    
    const balance = parseFloat(balanceInput.value);
    if (balance === 0) valBalance.textContent = "Center";
    else if (balance < 0) valBalance.textContent = `L ${Math.abs(Math.round(balance * 100))}%`;
    else valBalance.textContent = `R ${Math.abs(Math.round(balance * 100))}%`;
}

// Attach Inputs and Hardware Nodes to Real-time Sync listeners
compressorToggle.addEventListener('change', () => {
    routeAudioPipeline();
});

eqBassInput.addEventListener('input', (e) => {
    updateControlLabels();
    if (eqBassNode) eqBassNode.gain.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
});

eqMidInput.addEventListener('input', (e) => {
    updateControlLabels();
    if (eqMidNode) eqMidNode.gain.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
});

eqTrebleInput.addEventListener('input', (e) => {
    updateControlLabels();
    if (eqTrebleNode) eqTrebleNode.gain.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
});

balanceInput.addEventListener('input', (e) => {
    updateControlLabels();
    if (pannerNode) pannerNode.pan.setValueAtTime(parseFloat(e.target.value), audioCtx.currentTime);
});

// 🚀 MASTER DECK RESET EVENT HANDLER
btnReset.addEventListener('click', () => {
    // 1. Rollback DOM UI parameters down to initial defaults
    compressorToggle.checked = false;
    eqBassInput.value = 0;
    eqMidInput.value = 0;
    eqTrebleInput.value = 0;
    balanceInput.value = 0;

    // 2. Refresh alphanumeric display labels text nodes
    updateControlLabels();

    // 3. Re-verify pipeline paths (Safely shuts off Compressor loop if active)
    routeAudioPipeline();

    // 4. Force underlying Audio Nodes back to perfectly flat responses instantly
    if (audioCtx) {
        const now = audioCtx.currentTime;
        if (eqBassNode) eqBassNode.gain.setValueAtTime(0, now);
        if (eqMidNode) eqMidNode.gain.setValueAtTime(0, now);
        if (eqTrebleNode) eqTrebleNode.gain.setValueAtTime(0, now);
        if (pannerNode) pannerNode.pan.setValueAtTime(0, now);
    }
});

// Real-time Rendering Loop using Canvas
function drawVisualizer() {
    requestAnimationFrame(drawVisualizer); 

    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    analyser.getByteFrequencyData(dataArray);

    canvasCtx.fillStyle = '#10121a'; // Matches your shiny card body dark profile background
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 1.3;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] * 0.35; // Calibrated bar scale padding variables 
        canvasCtx.fillStyle = `rgb(0, ${Math.min(180 + barHeight, 255)}, 255)`;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 3, barHeight);
        x += barWidth;
    }
}

// Check IndexedDB
async function checkSavedDirectory() {
    const savedHandle = await idbKeyval.get('music-folder');
    if (savedHandle) {
        const permission = await verifyPermission(savedHandle);
        if (permission) loadLibrary(savedHandle);
    }
}

// Scan folder & load library
async function loadLibrary(dirHandle) {
    const mm = await import('https://cdn.jsdelivr.net/npm/music-metadata@11.12.3/+esm');
    trackList.innerHTML = '';
    fileMap.clear();
    loadingText.textContent = "(Loading Metadata...)";

    let flacCount = 0;

    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.flac')) {
            flacCount++;
            const file = await entry.getFile();
            let title = entry.name.replace(/\.flac$/i, '');
            let artist = "Unknown Artist";
            let pictureData = null;

            try {
                const metadata = await mm.parseBlob(file);
                if (metadata.common.title) title = metadata.common.title;
                if (metadata.common.artist) artist = metadata.common.artist;
                if (metadata.common.picture && metadata.common.picture.length > 0) {
                    pictureData = metadata.common.picture[0];
                }
            } catch (err) {
                console.warn(`Could not read metadata for ${entry.name}`);
            }

            fileMap.set(entry.name, { handle: entry, title, artist, pictureData });

            const li = document.createElement('li');
            li.className = 'track-item';
            li.innerHTML = `
                <div class="track-meta">
                    <span class="track-title">${title}</span>
                    <span class="track-artist">${artist}</span>
                </div>
            `;
            li.addEventListener('click', () => playTrack(entry.name));
            trackList.appendChild(li);
        }
    }

    loadingText.textContent = "";
    if (flacCount === 0) {
        trackList.innerHTML = '<li class="empty-state">No FLAC files found.</li>';
    }
}

// Play track
async function playTrack(fileName) {
    const trackData = fileMap.get(fileName);
    if (!trackData) return;

    try {
        const file = await trackData.handle.getFile();
        const fileURL = URL.createObjectURL(file);
        
        nowPlayingText.textContent = trackData.title;
        nowArtistText.textContent = trackData.artist;
        
        // Fetch lyrics
        if (trackData.artist !== "Unknown Artist") {
            fetchLyrics(trackData.title, trackData.artist);
        } else {
            setStaticLyrics("Cannot fetch lyrics for Unknown Artist.");
        }
        
        // Handle Album Art
        if (trackData.pictureData) {
            // FIXED: Avoid String.fromCharCode.apply entirely to prevent Call Stack errors
            const blob = new Blob([trackData.pictureData.data], { type: trackData.pictureData.format });
            const artURL = URL.createObjectURL(blob);
            
            albumArt.src = artURL;
            albumArt.style.display = 'block';
            artPlaceholder.style.display = 'none';
        } else {
            albumArt.style.display = 'none';
            artPlaceholder.style.display = 'block';
        }

        initWebAudio();
        
        // Web Browsers frequently place Context inside a "suspended" mode state to preserve system battery. 
        // Wake it back up explicitly alongside a user track execution instruction.
        if (audioCtx && audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        audioPlayer.src = fileURL;
        audioPlayer.play();
    } catch (err) {
        console.error('Playback error:', err);
    }
}

// Clean text data for API queries
function cleanMetadata(text) {
    if (!text) return "";
    return text.replace(/^\d+[\s.-]*/, '').replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/(ft\.|feat\.).*$/i, '').trim();
}

// Fetch and route lyrics parsing
async function fetchLyrics(rawTitle, rawArtist) {
    lyricsContainer.innerHTML = '<p class="lyric-line active">Loading synced lyrics...</p>';
    parsedLyrics = []; // Reset global lyric array
    lastActiveIndex = -1;
    
    try {
        const cleanTitle = cleanMetadata(rawTitle);
        const cleanArtist = cleanMetadata(rawArtist);
        const searchQuery = encodeURIComponent(`${cleanTitle} ${cleanArtist}`);
        
        const response = await fetch(`https://lrclib.net/api/search?q=${searchQuery}`);
        const data = await response.json();

        if (data && data.length > 0) {
            const bestMatch = data[0];
            
            // Check if synced timestamp lyrics exist first!
            if (bestMatch.syncedLyrics) {
                parseAndRenderLRC(bestMatch.syncedLyrics);
            } else if (bestMatch.plainLyrics) {
                // Fallback to old plain lyrics if timestamps don't exist
                setStaticLyrics(bestMatch.plainLyrics);
            } else {
                setStaticLyrics("Instrumental or lyrics unavailable.");
            }
        } else {
            setStaticLyrics("No lyrics found in cloud database.");
        }
    } catch (err) {
        setStaticLyrics("Error connecting to lyrics engine.");
    }
}

// Utility to set un-synced text
function setStaticLyrics(text) {
    parsedLyrics = []; // Clear array so time tracking stops
    lyricsContainer.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'lyric-line active';
    p.style.whiteSpace = 'pre-wrap';
    p.textContent = text;
    lyricsContainer.appendChild(p);
}

// Parse LRC strings [00:12.34] text -> JavaScript Objects
function parseAndRenderLRC(lrcText) {
    lyricsContainer.innerHTML = '';
    const lines = lrcText.split('\n');
    const timeRegex = /\[(\d+):(\d+(?:\.\d+)?)\]/;

    lines.forEach(line => {
        const match = timeRegex.exec(line);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseFloat(match[2]);
            const totalSeconds = (minutes * 60) + seconds;
            const text = line.replace(timeRegex, '').trim();

            parsedLyrics.push({ time: totalSeconds, text: text || "🎵" });
        }
    });

    // Generate elements inside the HTML DOM
    parsedLyrics.forEach((line, index) => {
        const p = document.createElement('p');
        p.className = 'lyric-line';
        p.textContent = line.text;
        p.id = `line-${index}`; // ID for scrolling reference
        lyricsContainer.appendChild(p);
    });
}

// 🌟 BULLETPROOF TIME TRACKING: Guarantees highlighting and isolated scrolling
audioPlayer.addEventListener('timeupdate', () => {
    if (parsedLyrics.length === 0) return; 

    const currentTime = audioPlayer.currentTime;
    let activeIndex = -1;

    // Find the current playing line
    for (let i = 0; i < parsedLyrics.length; i++) {
        if (currentTime >= parsedLyrics[i].time) {
            activeIndex = i;
        } else {
            break; 
        }
    }

    // Only trigger when the line actually changes
    if (activeIndex !== -1 && activeIndex !== lastActiveIndex) {
        lastActiveIndex = activeIndex; 

        // 1. Remove the active class from all lines first
        const allLines = lyricsContainer.querySelectorAll('.lyric-line');
        allLines.forEach(line => line.classList.remove('active'));

        // 2. Get the specific line element
        const activeLineElement = document.getElementById(`line-${activeIndex}`);
        
        if (activeLineElement) {
            // 3. FORCE HIGHLIGHT (This happens first no matter what)
            activeLineElement.classList.add('active');
            
            // 4. FAILSAFE SCROLLING: Uses absolute viewport bounding boxes 
            // (Completely immune to CSS 'position: relative' bugs)
            const containerRect = lyricsContainer.getBoundingClientRect();
            const lineRect = activeLineElement.getBoundingClientRect();

            // Find where the line is relative to the inside of the dark box
            const relativeLineTop = lineRect.top - containerRect.top;
            
            // Math to find the perfect center point
            const targetScrollTop = lyricsContainer.scrollTop + relativeLineTop - (containerRect.height / 2) + (lineRect.height / 2);

            // Scroll the container
            lyricsContainer.scrollTo({
                top: targetScrollTop,
                behavior: 'smooth'
            });
        }
    }
});

// 🚀 COLLAPSIBLE MODULE DRAWER HANDLER
rackTrigger.addEventListener('click', (e) => {
    // Prevent collapsing if the user is explicitly trying to click the Reset button
    if (e.target.id === 'btn-reset') return;

    // Toggle the class name to let CSS slide it open or closed safely
    controlRack.classList.toggle('collapsed');
});