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
const linkClearFolder = document.getElementById('link-clear-folder');
// Grab references to our new queue UI components
const queueContainer = document.getElementById('queue-container');
const queueList = document.getElementById('queue-list');
const btnClearQueue = document.getElementById('btn-clear-queue');
// Controller Deck DOM Hook References
const btnPrev = document.getElementById('btn-prev');
const btnPlayToggle = document.getElementById('btn-play-toggle');
const btnNext = document.getElementById('btn-next');
const timelineSlider = document.getElementById('timeline-slider');
const timeCurrent = document.getElementById('time-current');
const timeDuration = document.getElementById('time-duration');
const formatScopeToggle = document.getElementById('format-scope-toggle');

// Data Management State Variables
let fileMap = new Map();
let parsedLyrics = []; 
let lastActiveIndex = -1; 
let savedFolderHandle = null; // 🚀 NEW: Keeps track of the loaded folder state
let playbackQueue = []; 
let playbackHistory = []; 
let currentTrackKey = null; // Remembers what unique file string is currently loaded

// 1. Initialize App & Register Service Worker (PWA)
window.addEventListener('load', async () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
    
    const savedHandle = await idbKeyval.get('music-folder');
    if (savedHandle) {
        savedFolderHandle = savedHandle;
        btnOpen.textContent = "Unlock Saved Library"; 
        linkClearFolder.style.display = "inline-block"; // Show the disconnect button option
        trackList.innerHTML = '<li class="empty-state">Saved library detected. Click "Unlock Saved Library" above to sync your device files.</li>';
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

        // SCENARIO A: Fresh load, no folder has been cached yet
        if (!dirHandle) {
            dirHandle = await window.showDirectoryPicker();
            await idbKeyval.set('music-folder', dirHandle);
            savedFolderHandle = dirHandle;
            linkClearFolder.style.display = "inline-block";
        } else {
            // SCENARIO B: Unlocking an existing cached folder handle
            const permission = await verifyPermission(dirHandle);
            if (!permission) {
                // Handle denial gracefully
                savedFolderHandle = null;
                linkClearFolder.style.display = "none";
                btnOpen.textContent = "Select Music Folder";
                trackList.innerHTML = '<li class="empty-state">Permission denied by client browser.</li>';
                return;
            }
        }

        // Once confirmed, change main text label to active status indicator
        btnOpen.textContent = "Library Synchronized";
        loadLibrary(dirHandle);

    } catch (err) {
        console.log('Folder acquisition lifecycle canceled or interrupted.', err);
    }
});

// 3. Single-Click Clear Trigger Handler Link (With Queue & Lyrics Flush Integration)
linkClearFolder.addEventListener('click', async (e) => {
    e.preventDefault(); // Stop page from jumping to top anchor point
    
    // 1. Wipe local storage indices and cached folder handles entirely
    await idbKeyval.del('music-folder');
    savedFolderHandle = null;
    
    // 2. Flush the playback queue and history matrices instantly
    playbackQueue = [];
    playbackHistory = [];
    currentTrackKey = null;
    renderQueueUI(); // Repaints the sidebar UI panel to hide the "Up Next" container tray
    
    // 3. 🚀 NEW: Clear out the synced lyrics panel text and reset tracking states
    // This targets your core lyrics DOM rendering containers
    const lyricBox = document.getElementById('lyrics-container') || 
                     document.getElementById('lyrics-box') || 
                     document.getElementById('lyrics-display');
                     
    if (lyricBox) {
        lyricBox.innerHTML = '<p class="lyric-empty" style="color: #4b5563; font-style: italic; text-align: center; margin-top: 40px;">Select a track to load library lyrics</p>';
    }
    
    // Reset any global lyric-tracking timer or array parameters if your lyric engine uses them
    if (typeof currentLyrics !== 'undefined') currentLyrics = [];
    if (typeof lyricLines !== 'undefined') lyricLines = [];

    // 4. Reset buttons back to initial defaults layout
    btnOpen.textContent = "Select Music Folder";
    linkClearFolder.style.display = "none";
    trackList.innerHTML = '<li class="empty-state">Folder disconnected. Select a new directory to load music.</li>';
    
    // 5. Refresh the player screen profile deck values back to blank state
    nowPlayingText.textContent = "Now Playing: ---";
    nowArtistText.textContent = "Artist: ---";
    audioPlayer.src = "";
    btnPlayToggle.textContent = "▶"; 
    
    // 6. Clean up artwork rendering states
    albumArt.style.display = "none";
    artPlaceholder.style.display = "flex";
    
    // 7. Reset timeline tracking sliders back to zero parameters position
    timelineSlider.value = 0;
    timelineSlider.max = 100;
    timeCurrent.textContent = "0:00";
    timeDuration.textContent = "0:00";
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

// Helper utility to turn messy file names into pristine, browser-safe element IDs
function makeSafeId(str) {
    return 'track-' + encodeURIComponent(str).replace(/%/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
}

// 4. Upgraded Format-Aware Directory Tree Engine: Dynamically maps selectable file arrays
async function loadLibrary(dirHandle) {
    trackList.innerHTML = '';
    fileMap.clear();
    loadingText.textContent = "(Building library tree...)";

    // Detect user preferences state configuration selection paths right now
    const allowAllFormats = formatScopeToggle.checked;

    // Helper evaluation utility to validate track names against configuration constraints
    function isValidAudioFile(filename) {
        const lowerName = filename.toLowerCase();
        if (allowAllFormats) {
            // Expanded compatibility tracking matrix
            return lowerName.endsWith('.flac') || 
                   lowerName.endsWith('.mp3')  || 
                   lowerName.endsWith('.wav')  || 
                   lowerName.endsWith('.m4a')  || 
                   lowerName.endsWith('.ogg');
        }
        // Strict baseline fallback execution criteria
        return lowerName.endsWith('.flac');
    }

    // Single-pass structural scanner that filters files instantly by format types configuration
    async function buildDOM(folderHandle, parentDOMElement) {
        for await (const entry of folderHandle.values()) {
            if (entry.kind === 'directory') {
                const folderDiv = document.createElement('div');
                folderDiv.className = 'tree-folder collapsed';

                const headerDiv = document.createElement('div');
                headerDiv.className = 'folder-header';
                headerDiv.innerHTML = `<span class="folder-icon">▶</span> 📁 ${entry.name}`;

                const contentDiv = document.createElement('div');
                contentDiv.className = 'folder-content';

                headerDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    folderDiv.classList.toggle('expanded');
                });

                folderDiv.appendChild(headerDiv);
                folderDiv.appendChild(contentDiv);
                parentDOMElement.appendChild(folderDiv);

                await buildDOM(entry, contentDiv);
                
                if (contentDiv.children.length === 0) {
                    folderDiv.remove();
                }
            } 
            // 🚀 UPGRADED: Dynamic condition evaluation check
            else if (entry.kind === 'file' && isValidAudioFile(entry.name)) {
                
                const fileObj = await entry.getFile();
                const fullUniqueKey = `${entry.name}-${fileObj.size}`;
                
                // Clean extension suffixes labels presentation smoothly
                const cleanTitle = entry.name.replace(/\.(flac|mp3|wav|m4a|ogg)$/i, '');
                const fileExt = entry.name.split('.').pop().toUpperCase();

                fileMap.set(fullUniqueKey, { 
                    handle: entry, 
                    title: cleanTitle, 
                    artist: "Local Audio" 
                });

                const li = document.createElement('li');
                li.className = 'track-item';
                li.id = makeSafeId(fullUniqueKey);
                li.innerHTML = `
                    <div class="track-meta" style="max-width: 75%;">
                        <span class="track-title">${cleanTitle}</span>
                        <span class="track-artist" style="color: #4b5563;">${fileExt} Audio</span>
                    </div>
                    <button class="btn-add-queue" data-filename="${fullUniqueKey}">+ Queue</button>
                `;
                
                li.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (e.target.classList.contains('btn-add-queue')) {
                        addToQueue(fullUniqueKey);
                        return;
                    }

                    const parentFolder = li.parentElement;
                    if (parentFolder) {
                        const siblingTracks = Array.from(parentFolder.querySelectorAll(':scope > .track-item'));
                        const clickedIndex = siblingTracks.indexOf(li);
                        playbackQueue = [];

                        for (let i = clickedIndex + 1; i < siblingTracks.length; i++) {
                            const siblingButton = siblingTracks[i].querySelector('.btn-add-queue');
                            if (siblingButton) {
                                playbackQueue.push(siblingButton.getAttribute('data-filename'));
                            }
                        }
                        renderQueueUI();
                    }
                    playTrack(fullUniqueKey);
                });
                
                parentDOMElement.appendChild(li);
            }
        }
    }

    await buildDOM(dirHandle, trackList);

    loadingText.textContent = "";
    if (fileMap.size === 0) {
        trackList.innerHTML = `<li class="empty-state">No matching audio files found (${allowAllFormats ? 'MP3/WAV/M4A/FLAC' : 'FLAC Only'}).</li>`;
    }
}

// 🚀 RE-INDEX ON TOGGLE INTERACTION
formatScopeToggle.addEventListener('change', () => {
    if (savedFolderHandle) {
        loadLibrary(savedFolderHandle);
    }
});

// 5. Upgraded On-Demand Track Player: Parses metadata safely at the moment of user click
async function playTrack(filename) {
    // 🚀 QUEUE HISTORY CAPTURE: If a track is already playing, push it to history before changing
    if (currentTrackKey && currentTrackKey !== filename) {
        playbackHistory.push(currentTrackKey);
    }
    currentTrackKey = filename;
    const trackData = fileMap.get(filename);
    if (!trackData) return;

    try {
        // Initialize Web Audio graph if this is the first interaction
        if (!audioCtx) {
            initWebAudio();
        }

        nowPlayingText.textContent = "Loading track details...";
        nowArtistText.textContent = "";
        albumArt.style.display = "none";
        artPlaceholder.style.display = "flex";

        // Fetch the individual file stream right now inside the user action scope
        const file = await trackData.handle.getFile();
        
        // Dynamically import the metadata manager on-demand
        const mm = await import('https://cdn.jsdelivr.net/npm/music-metadata@11.12.3/+esm');
        
        try {
            const metadata = await mm.parseBlob(file);
            
            // Extract track configurations safely
            if (metadata.common.title) trackData.title = metadata.common.title;
            if (metadata.common.artist) {
                trackData.artist = metadata.common.artist;
            } else if (metadata.common.albumartist) {
                trackData.artist = metadata.common.albumartist;
            }

            // Extract and build the Album Cover Art layout
            if (metadata.common.picture && metadata.common.picture.length > 0) {
                const pic = metadata.common.picture[0];
                const blob = new Blob([pic.data], { type: pic.format });
                albumArt.src = URL.createObjectURL(blob);
                albumArt.style.display = "block";
                artPlaceholder.style.display = "none";
            }

            // Dynamically update the specific sidebar list item text so it saves your library details
            const elementId = makeSafeId(filename);
            const trackLi = document.getElementById(elementId);
            if (trackLi) {
                trackLi.querySelector('.track-title').textContent = trackData.title;
                trackLi.querySelector('.track-artist').textContent = trackData.artist;
            }

        } catch (metaErr) {
            console.warn("Metadata tags could not be read for this file.", metaErr);
        }

        // Display current values on the player deck dashboard
        nowPlayingText.textContent = trackData.title;
        nowArtistText.textContent = trackData.artist;

        // Load synced lyrics if your lyric search framework is active
        if (typeof fetchLyrics === 'function') {
            fetchLyrics(trackData.title, trackData.artist);
        }

        // Convert the fresh file handle into a local safe URL stream block and start playback
        const fileURL = URL.createObjectURL(file);
        audioPlayer.src = fileURL;
        audioPlayer.play();
        // Update the custom button icon to show pause symbol when playing
        btnPlayToggle.textContent = "⏸";

    } catch (err) {
        console.error("Critical failure during track playback initialization:", err);
        nowPlayingText.textContent = "Error opening file stream";
        nowArtistText.textContent = "Please try clicking the track again.";
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

// 🚀 UPGRADED GLOBAL KEYBOARD SHORTCUTS CONTROLLER
window.addEventListener('keydown', (e) => {
    // If the audio player doesn't have a file loaded yet, ignore key presses
    if (!audioPlayer.src) return;

    // Convert key name to lowercase to handle caps-lock smoothly
    const key = e.key.toLowerCase();
    
    // Check if Ctrl (Windows/Linux) or Cmd (Mac) is being held down
    const isModifierActive = e.ctrlKey || e.metaKey;

    switch (key) {
        // 1. PLAY / PAUSE (Spacebar or K)
        case ' ':
        case 'k':
            // Don't intercept spacebar if modifier is held (lets standard OS shortcuts work)
            if (isModifierActive) return; 
            e.preventDefault(); 
            if (audioPlayer.paused) {
                audioPlayer.play();
            } else {
                audioPlayer.pause();
            }
            break;

        // 2. SKIP FORWARD (Ctrl+Right Arrow for Next Track OR L/Right Arrow for 10s Seek)
        case 'arrowright':
        case 'l':
            e.preventDefault();
            if (isModifierActive || key === 'l') {
                // ⏭️ Ctrl + Right Arrow or L triggers full Next Track Skip
                if (typeof skipToNext === 'function') skipToNext();
            } else {
                // Standard Right Arrow seeks forward 10 seconds
                audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 10);
            }
            break;

        // 3. SKIP BACKWARD (Ctrl+Left Arrow for Previous Track OR J/Left Arrow for 10s Seek)
        case 'arrowleft':
        case 'j':
            e.preventDefault();
            if (isModifierActive || key === 'j') {
                // ⏮️ Ctrl + Left Arrow or J triggers full Previous Track Skip
                // Mimic the physical button click event to run our precise 3-second history logic
                if (btnPrev) btnPrev.click();
            } else {
                // Standard Left Arrow seeks backward 10 seconds
                audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 10);
            }
            break;

        // 4. VOLUME UP 5% (Up Arrow)
        case 'arrowup':
            if (isModifierActive) return; // Prevent conflicting with system window shortcuts
            e.preventDefault();
            audioPlayer.volume = Math.min(1, audioPlayer.volume + 0.05);
            break;

        // 5. VOLUME DOWN 5% (Down Arrow)
        case 'arrowdown':
            if (isModifierActive) return;
            e.preventDefault();
            audioPlayer.volume = Math.max(0, audioPlayer.volume - 0.05);
            break;

        // 6. MUTE / UNMUTE TOGGLE (M)
        case 'm':
            if (isModifierActive) return;
            e.preventDefault();
            audioPlayer.muted = !audioPlayer.muted;
            break;

        default:
            break;
    }
});

// 🚀 CORE QUEUE MANAGER FUNCTIONS

// Add track filename handle into queue matrix arrays
function addToQueue(filename) {
    const trackData = fileMap.get(filename);
    if (!trackData) return;

    // Push into runtime state data array
    playbackQueue.push(filename);
    renderQueueUI();
}

// Render queue list entries visually in the dashboard tray panel
function renderQueueUI() {
    queueList.innerHTML = '';

    if (playbackQueue.length === 0) {
        queueContainer.style.display = "none";
        return;
    }

    queueContainer.style.display = "block";

    playbackQueue.forEach((filename, index) => {
        const trackData = fileMap.get(filename);
        if (!trackData) return;

        const li = document.createElement('li');
        li.className = 'queue-item';
        li.innerHTML = `
            <div class="queue-item-meta">
                <span class="queue-item-title">${trackData.title}</span>
                <span class="queue-item-artist">${trackData.artist}</span>
            </div>
            <button class="btn-remove-queue" data-index="${index}">✕</button>
        `;

        // Handle pulling a single track out of queue order positioning manually
        li.querySelector('.btn-remove-queue').addEventListener('click', (e) => {
            e.stopPropagation();
            playbackQueue.splice(index, 1);
            renderQueueUI();
        });

        queueList.appendChild(li);
    });
}

// Clear out everything inside queue arrays
btnClearQueue.addEventListener('click', () => {
    playbackQueue = [];
    renderQueueUI();
});

// 🚀 CONTINUOUS PLAYBACK PIPELINE: Checks queue immediately when active track finishes
audioPlayer.addEventListener('ended', () => {
    if (playbackQueue.length > 0) {
        // Shift pulls the top song index out of the queue and plays it immediately
        const nextTrackFilename = playbackQueue.shift();
        renderQueueUI(); // Repaint tray layout map values
        playTrack(nextTrackFilename);
    }
});

// 🚀 CUSTOM TRACK CONTROLLER DRAWER LOGIC

// 1. Play / Pause Central UI Switch Trigger
btnPlayToggle.addEventListener('click', () => {
    if (!audioPlayer.src) return;

    if (audioPlayer.paused) {
        audioPlayer.play();
        btnPlayToggle.textContent = "⏸";
    } else {
        audioPlayer.pause();
        btnPlayToggle.textContent = "▶";
    }
});

// Update play button state if paused outside custom controls (like via keyboard shortucts)
audioPlayer.addEventListener('play', () => btnPlayToggle.textContent = "⏸");
audioPlayer.addEventListener('pause', () => btnPlayToggle.textContent = "▶");

// 2. SKIP NEXT TRACK FUNCTION (⏭️)
function skipToNext() {
    if (playbackQueue.length > 0) {
        const nextTrackFilename = playbackQueue.shift();
        renderQueueUI(); // Repaint queue layout panel
        playTrack(nextTrackFilename);
    } else {
        console.log("End of queue reached.");
        // Optional: Implement auto-advance to next item in file tree if queue is empty
    }
}
btnNext.addEventListener('click', skipToNext);

// Bind our auto-advance listener to use the upgraded skipToNext handler
audioPlayer.removeEventListener('ended', () => {}); // Clear old reference block
audioPlayer.addEventListener('ended', skipToNext);

// 3. SKIP PREVIOUS TRACK FUNCTION (⏮️)
btnPrev.addEventListener('click', () => {
    if (!audioPlayer.src) return;

    // Failsafe condition: If song has played for more than 3 seconds, restart it
    if (audioPlayer.currentTime > 3) {
        audioPlayer.currentTime = 0;
        return;
    }

    // Otherwise, pop the last song out of history and play it
    if (playbackHistory.length > 0) {
        const previousTrackFilename = playbackHistory.pop();
        
        // Put current track back to the top of queue line to allow stepping forward again
        if (currentTrackKey) {
            playbackQueue.unshift(currentTrackKey);
            renderQueueUI();
        }
        
        // Prevent adding current track to history during this transition cycle
        currentTrackKey = null; 
        playTrack(previousTrackFilename);
    } else {
        // No history exists, just loop back to start of song
        audioPlayer.currentTime = 0;
    }
});

// 4. TIMELINE BAR CONTROLLER & TIME STAMP SYNCHRONIZER
function formatTime(secs) {
    if (isNaN(secs)) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

// Update track max duration lengths once loaded
audioPlayer.addEventListener('durationchange', () => {
    timelineSlider.max = Math.floor(audioPlayer.duration);
    timeDuration.textContent = formatTime(audioPlayer.duration);
});

// Update slider thumb placement dynamically as audio proceeds
audioPlayer.addEventListener('timeupdate', () => {
    if (!audioPlayer.duration) return;
    timelineSlider.value = Math.floor(audioPlayer.currentTime);
    timeCurrent.textContent = formatTime(audioPlayer.currentTime);
});

// Let user drag timeline slider handle to seek smoothly mid-song
timelineSlider.addEventListener('input', () => {
    audioPlayer.currentTime = timelineSlider.value;
});