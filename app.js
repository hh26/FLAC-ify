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
const btnReset = document.getElementById('btn-reset');
const valBass = document.getElementById('val-bass');
const valMid = document.getElementById('val-mid');
const valTreble = document.getElementById('val-treble');
const valBalance = document.getElementById('val-balance');
const controlRack = document.getElementById('control-rack');
const rackTrigger = document.getElementById('rack-trigger');
const linkClearFolder = document.getElementById('link-clear-folder');
const queueContainer = document.getElementById('queue-container');
const queueList = document.getElementById('queue-list');
const btnClearQueue = document.getElementById('btn-clear-queue');
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
let savedFolderHandle = null; 
let playbackQueue = []; 
let playbackHistory = []; 
let currentTrackKey = null; 

// Volume HUD State Matrix Tracker Variables
const volumeHUD = document.getElementById('volume-hud');
const hudFill = document.getElementById('hud-fill');
const hudPercentage = document.getElementById('hud-percentage');
const hudIcon = volumeHUD.querySelector('.hud-icon');
let hudTimer = null;

// Playback State Mode Configurations
let isShuffleActive = false;
let repeatMode = 'linear'; // Options: 'linear' -> 'one' -> 'all'
let masterQueueBackup = []; 

const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeatMode = document.getElementById('btn-repeat-mode');

// Helper utility to turn messy file names into pristine, browser-safe element IDs
function makeSafeId(str) {
    return 'track-' + encodeURIComponent(str).replace(/%/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
}

// 1. Initialize App & Register Service Worker (PWA)
window.addEventListener('load', async () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
    
    const savedHandle = await idbKeyval.get('music-folder');
    if (savedHandle) {
        savedFolderHandle = savedHandle;
        btnOpen.textContent = "Unlock Saved Library"; 
        linkClearFolder.style.display = "inline-block"; 
        trackList.innerHTML = '<li class="empty-state">Saved library detected. Click "Unlock Saved Library" above to sync your device files.</li>';
    }
});

// Helper to query permission state
async function verifyPermission(fileHandle) {
    const options = { mode: 'read' };
    if ((await fileHandle.queryPermission(options)) === 'granted') return true;
    if ((await fileHandle.requestPermission(options)) === 'granted') return true;
    return false;
}

// 2. Upgraded Main Button Click Event Listener (With Brave & Firefox Fallback Engine)
btnOpen.addEventListener('click', async () => {
    try {
        const supportsModernPicker = 'showDirectoryPicker' in window;

        if (supportsModernPicker) {
            // --- CHROMIUM/CHROME PATHWAY ---
            let dirHandle = savedFolderHandle;

            if (!dirHandle) {
                dirHandle = await window.showDirectoryPicker();
                await idbKeyval.set('music-folder', dirHandle);
                savedFolderHandle = dirHandle;
                linkClearFolder.style.display = "inline-block";
            } else {
                const permission = await verifyPermission(dirHandle);
                if (!permission) {
                    savedFolderHandle = null;
                    linkClearFolder.style.display = "none";
                    btnOpen.textContent = "Select Music Folder";
                    trackList.innerHTML = '<li class="empty-state">Permission denied by client browser.</li>';
                    return;
                }
            }

            btnOpen.textContent = "Library Synchronized";
            loadLibrary(dirHandle);

        } else {
            // --- BRAVE / FIREFOX / SAFARI FALLBACK PATHWAY ---
            console.log("Modern File System API blocked or unsupported. Launching standard folder engine...");
            
            const fallbackInput = document.createElement('input');
            fallbackInput.type = 'file';
            fallbackInput.webkitdirectory = true; 
            fallbackInput.multiple = true;
            
            fallbackInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files);
                if (files.length === 0) return;

                trackList.innerHTML = '';
                fileMap.clear();
                loadingText.textContent = "(Indexing files...)";

                const allowAllFormats = formatScopeToggle.checked;
                files.sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath));

                files.forEach(file => {
                    const lowerName = file.name.toLowerCase();
                    const isValid = allowAllFormats 
                        ? (lowerName.endsWith('.flac') || lowerName.endsWith('.mp3') || lowerName.endsWith('.wav') || lowerName.endsWith('.m4a') || lowerName.endsWith('.ogg'))
                        : lowerName.endsWith('.flac');

                    if (isValid) {
                        const fullUniqueKey = `${file.name}-${file.size}`;
                        const cleanTitle = file.name.replace(/\.(flac|mp3|wav|m4a|ogg)$/i, '');
                        const fileExt = file.name.split('.').pop().toUpperCase();

                        fileMap.set(fullUniqueKey, {
                            isFallbackFile: true,
                            filePayload: file,
                            title: cleanTitle,
                            artist: "Local Audio"
                        });

                        const li = document.createElement('li');
                        li.className = 'track-item';
                        li.id = makeSafeId(fullUniqueKey);
                        li.innerHTML = `
                            <div class="track-meta" style="max-width: 75%;">
                                <span class="track-title">${cleanTitle}</span>
                                <span class="track-artist" style="color: #4b5563;">${fileExt} / ${file.webkitRelativePath.split('/')[0]}</span>
                            </div>
                            <button class="btn-add-queue" data-filename="${fullUniqueKey}">+ Queue</button>
                        `;

                        li.addEventListener('click', (evt) => {
                            evt.stopPropagation();
                            if (evt.target.classList.contains('btn-add-queue')) {
                                addToQueue(fullUniqueKey);
                                return;
                            }
                            
                            const parentFolder = li.parentElement;
                            if (parentFolder) {
                                const siblingTracks = Array.from(parentFolder.querySelectorAll('.track-item'));
                                const clickedIndex = siblingTracks.indexOf(li);
                                playbackQueue = [];
                                masterQueueBackup = [];

                                for (let i = clickedIndex + 1; i < siblingTracks.length; i++) {
                                    const btn = siblingTracks[i].querySelector('.btn-add-queue');
                                    if (btn) {
                                        const siblingKey = btn.getAttribute('data-filename');
                                        playbackQueue.push(siblingKey);
                                        masterQueueBackup.push(siblingKey);
                                    }
                                }

                                if (isShuffleActive) shuffleArray(playbackQueue);
                                renderQueueUI();
                            }
                            playTrack(fullUniqueKey);
                        });

                        trackList.appendChild(li);
                    }
                });

                loadingText.textContent = "";
                btnOpen.textContent = "Folder Selected";
                linkClearFolder.style.display = "inline-block";
                
                if (fileMap.size === 0) {
                    trackList.innerHTML = '<li class="empty-state">No matching audio files found inside this directory structure.</li>';
                }
            });

            fallbackInput.click();
        }

    } catch (err) {
        console.log('Folder acquisition lifecycle canceled or interrupted.', err);
    }
});

// 3. Single-Click Clear Trigger Handler Link (With Queue & Lyrics Flush Integration)
linkClearFolder.addEventListener('click', async (e) => {
    e.preventDefault(); 
    
    await idbKeyval.del('music-folder');
    savedFolderHandle = null;
    
    playbackQueue = [];
    playbackHistory = [];
    masterQueueBackup = [];
    currentTrackKey = null;
    renderQueueUI(); 
    
    const lyricBox = document.getElementById('lyrics-container') || 
                     document.getElementById('lyrics-box') || 
                     document.getElementById('lyrics-display');
                     
    if (lyricBox) {
        lyricBox.innerHTML = '<p class="lyric-empty" style="color: #4b5563; font-style: italic; text-align: center; margin-top: 40px;">Select a track to load library lyrics</p>';
    }
    
    if (typeof currentLyrics !== 'undefined') currentLyrics = [];
    if (typeof lyricLines !== 'undefined') lyricLines = [];

    btnOpen.textContent = "Select Music Folder";
    linkClearFolder.style.display = "none";
    trackList.innerHTML = '<li class="empty-state">Folder disconnected. Select a new directory to load music.</li>';
    
    nowPlayingText.textContent = "Now Playing: ---";
    nowArtistText.textContent = "Artist: ---";
    audioPlayer.src = "";
    btnPlayToggle.textContent = "▶"; 
    
    albumArt.style.display = "none";
    artPlaceholder.style.display = "flex";
    
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

    compressorNode = audioCtx.createDynamicsCompressor();
    compressorNode.threshold.setValueAtTime(-24, audioCtx.currentTime);
    compressorNode.knee.setValueAtTime(30, audioCtx.currentTime);
    compressorNode.ratio.setValueAtTime(12, audioCtx.currentTime);
    compressorNode.attack.setValueAtTime(0.003, audioCtx.currentTime);
    compressorNode.release.setValueAtTime(0.25, audioCtx.currentTime);

    eqBassNode = audioCtx.createBiquadFilter();
    eqBassNode.type = 'lowshelf';
    eqBassNode.frequency.value = 200; 
    eqBassNode.gain.value = parseFloat(eqBassInput.value);

    eqMidNode = audioCtx.createBiquadFilter();
    eqMidNode.type = 'peaking';
    eqMidNode.Q.value = 1.0; 
    eqMidNode.frequency.value = 2500; 
    eqMidNode.gain.value = parseFloat(eqMidInput.value);

    eqTrebleNode = audioCtx.createBiquadFilter();
    eqTrebleNode.type = 'highshelf';
    eqTrebleNode.frequency.value = 8000; 
    eqTrebleNode.gain.value = parseFloat(eqTrebleInput.value);

    pannerNode = audioCtx.createStereoPanner();
    pannerNode.pan.value = parseFloat(balanceInput.value);

    analyser.fftSize = 128;
    
    routeAudioPipeline();
    drawVisualizer();
}

function routeAudioPipeline() {
    if (!audioSource) return;

    audioSource.disconnect();
    compressorNode.disconnect();
    eqBassNode.disconnect();
    eqMidNode.disconnect();
    eqTrebleNode.disconnect();
    pannerNode.disconnect();
    analyser.disconnect();

    if (compressorToggle.checked) {
        audioSource.connect(compressorNode);
        compressorNode.connect(eqBassNode);
    } else {
        audioSource.connect(eqBassNode);
    }

    eqBassNode.connect(eqMidNode);
    eqMidNode.connect(eqTrebleNode);
    eqTrebleNode.connect(pannerNode);
    pannerNode.connect(analyser);
    analyser.connect(audioCtx.destination);
}

function updateControlLabels() {
    valBass.textContent = `${eqBassInput.value > 0 ? '+' : ''}${eqBassInput.value}dB`;
    valMid.textContent = `${eqMidInput.value > 0 ? '+' : ''}${eqMidInput.value}dB`;
    valTreble.textContent = `${eqTrebleInput.value > 0 ? '+' : ''}${eqTrebleInput.value}dB`;
    
    const balance = parseFloat(balanceInput.value);
    if (balance === 0) valBalance.textContent = "Center";
    else if (balance < 0) valBalance.textContent = `L ${Math.abs(Math.round(balance * 100))}%`;
    else valBalance.textContent = `R ${Math.abs(Math.round(balance * 100))}%`;
}

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

btnReset.addEventListener('click', () => {
    compressorToggle.checked = false;
    eqBassInput.value = 0;
    eqMidInput.value = 0;
    eqTrebleInput.value = 0;
    balanceInput.value = 0;

    updateControlLabels();
    routeAudioPipeline();

    if (audioCtx) {
        const now = audioCtx.currentTime;
        if (eqBassNode) eqBassNode.gain.setValueAtTime(0, now);
        if (eqMidNode) eqMidNode.gain.setValueAtTime(0, now);
        if (eqTrebleNode) eqTrebleNode.gain.setValueAtTime(0, now);
        if (pannerNode) pannerNode.pan.setValueAtTime(0, now);
    }
});

function drawVisualizer() {
    requestAnimationFrame(drawVisualizer); 
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    canvasCtx.fillStyle = '#10121a'; 
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 1.3;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] * 0.35; 
        canvasCtx.fillStyle = `rgb(0, ${Math.min(180 + barHeight, 255)}, 255)`;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 3, barHeight);
        x += barWidth;
    }
}

async function checkSavedDirectory() {
    const savedHandle = await idbKeyval.get('music-folder');
    if (savedHandle) {
        const permission = await verifyPermission(savedHandle);
        if (permission) loadLibrary(savedHandle);
    }
}

// 4. Upgraded Format-Aware Directory Tree Engine: Safe Structural Pass matching
async function loadLibrary(dirHandle) {
    trackList.innerHTML = '';
    fileMap.clear();
    loadingText.textContent = "(Building library tree...)";

    const allowAllFormats = formatScopeToggle.checked;

    function isValidAudioFile(filename) {
        const lowerName = filename.toLowerCase();
        if (allowAllFormats) {
            return lowerName.endsWith('.flac') || 
                   lowerName.endsWith('.mp3')  || 
                   lowerName.endsWith('.wav')  || 
                   lowerName.endsWith('.m4a')  || 
                   lowerName.endsWith('.ogg');
        }
        return lowerName.endsWith('.flac');
    }

    async function buildDOM(folderHandle, parentDOMElement) {
        for await (const entry of folderHandle.values()) {
            // ... inside buildDOM within loadLibrary, replace the 'directory' block with this:
            if (entry.kind === 'directory') {
                const folderDiv = document.createElement('div');
                folderDiv.className = 'tree-folder collapsed';

                const headerDiv = document.createElement('div');
                headerDiv.className = 'folder-header';
                // 🚀 NEW: Added the button template inline inside the header wrapper
                headerDiv.innerHTML = `
                    <div class="folder-title-clicker" style="cursor: pointer; flex-grow: 1;">
                        <span class="folder-icon">▶</span> 📁 ${entry.name}
                    </div>
                    <button class="btn-add-folder-queue" title="Add all songs in this folder to queue">+ Queue Folder</button>
                `;

                const contentDiv = document.createElement('div');
                contentDiv.className = 'folder-content';

                // Separate tree collapsing from the queue action button click
                headerDiv.querySelector('.folder-title-clicker').addEventListener('click', (e) => {
                    e.stopPropagation();
                    folderDiv.classList.toggle('expanded');
                });

                // 🚀 NEW: Recursively find and append all children audio track files underneath this node branch
                headerDiv.querySelector('.btn-add-folder-queue').addEventListener('click', (e) => {
                    e.stopPropagation();
                    
                    // Pull all individual tracks living inside this container layout element
                    const directChildButtons = Array.from(contentDiv.querySelectorAll('.btn-add-queue'));
                    
                    if (directChildButtons.length > 0) {
                        const tracksToAdd = directChildButtons.map(btn => btn.getAttribute('data-filename'));
                        
                        // If shuffle mode is engaged, randomize the folder layout cluster before adding it
                        if (isShuffleActive) {
                            shuffleArray(tracksToAdd);
                        }
                        
                        // Append directly to the active queue matrix arrays
                        playbackQueue = [...playbackQueue, ...tracksToAdd];
                        renderQueueUI();
                    }
                });

                folderDiv.appendChild(headerDiv);
                folderDiv.appendChild(contentDiv);
                parentDOMElement.appendChild(folderDiv);

                await buildDOM(entry, contentDiv);
                
                if (contentDiv.children.length === 0) {
                    folderDiv.remove();
                }
            }
            else if (entry.kind === 'file' && isValidAudioFile(entry.name)) {
                const fileObj = await entry.getFile();
                const fullUniqueKey = `${entry.name}-${fileObj.size}`;
                
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
                
                li.addEventListener('click', async (e) => {
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
                        masterQueueBackup = []; 

                        for (let i = clickedIndex + 1; i < siblingTracks.length; i++) {
                            const siblingButton = siblingTracks[i].querySelector('.btn-add-queue');
                            if (siblingButton) {
                                const siblingKey = siblingButton.getAttribute('data-filename');
                                playbackQueue.push(siblingKey);
                                masterQueueBackup.push(siblingKey); 
                            }
                        }

                        if (isShuffleActive) {
                            shuffleArray(playbackQueue);
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

formatScopeToggle.addEventListener('change', () => {
    if (savedFolderHandle) {
        loadLibrary(savedFolderHandle);
    }
});

// 5. Upgraded On-Demand Track Player
async function playTrack(filename) {
    if (currentTrackKey && currentTrackKey !== filename) {
        playbackHistory.push(currentTrackKey);
    }
    currentTrackKey = filename;
    const trackData = fileMap.get(filename);
    if (!trackData) return;

    try {
        if (!audioCtx) {
            initWebAudio();
        }

        nowPlayingText.textContent = "Loading track details...";
        nowArtistText.textContent = "";
        albumArt.style.display = "none";
        artPlaceholder.style.display = "flex";

        let file;
        if (trackData.isFallbackFile) {
            file = trackData.filePayload; 
        } else {
            file = await trackData.handle.getFile(); 
        }
        
        const mm = await import('https://cdn.jsdelivr.net/npm/music-metadata@11.12.3/+esm');
        
        try {
            const metadata = await mm.parseBlob(file);
            if (metadata.common.title) trackData.title = metadata.common.title;
            if (metadata.common.artist) {
                trackData.artist = metadata.common.artist;
            } else if (metadata.common.albumartist) {
                trackData.artist = metadata.common.albumartist;
            }

            if (metadata.common.picture && metadata.common.picture.length > 0) {
                const pic = metadata.common.picture[0];
                const blob = new Blob([pic.data], { type: pic.format });
                albumArt.src = URL.createObjectURL(blob);
                albumArt.style.display = "block";
                artPlaceholder.style.display = "none";
            }

            const elementId = makeSafeId(filename);
            const trackLi = document.getElementById(elementId);
            if (trackLi) {
                trackLi.querySelector('.track-title').textContent = trackData.title;
                trackLi.querySelector('.track-artist').textContent = trackData.artist;
            }

        } catch (metaErr) {
            console.warn("Metadata tags could not be read for this file.", metaErr);
        }

        nowPlayingText.textContent = trackData.title;
        nowArtistText.textContent = trackData.artist;

        if (typeof fetchLyrics === 'function') {
            fetchLyrics(trackData.title, trackData.artist);
        }

        const fileURL = URL.createObjectURL(file);
        audioPlayer.src = fileURL;
        audioPlayer.play();
        btnPlayToggle.textContent = "⏸";

    } catch (err) {
        console.error("Critical failure during track playback initialization:", err);
        nowPlayingText.textContent = "Error opening file stream";
        nowArtistText.textContent = "Please try clicking the track again.";
    }
}

function cleanMetadata(text) {
    if (!text) return "";
    return text.replace(/^\d+[\s.-]*/, '').replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/(ft\.|feat\.).*$/i, '').trim();
}

async function fetchLyrics(rawTitle, rawArtist) {
    lyricsContainer.innerHTML = '<p class="lyric-line active">Loading synced lyrics...</p>';
    parsedLyrics = []; 
    lastActiveIndex = -1;
    
    try {
        const cleanTitle = cleanMetadata(rawTitle);
        const cleanArtist = cleanMetadata(rawArtist);
        const searchQuery = encodeURIComponent(`${cleanTitle} ${cleanArtist}`);
        
        const response = await fetch(`https://lrclib.net/api/search?q=${searchQuery}`);
        const data = await response.json();

        if (data && data.length > 0) {
            const bestMatch = data[0];
            if (bestMatch.syncedLyrics) {
                parseAndRenderLRC(bestMatch.syncedLyrics);
            } else if (bestMatch.plainLyrics) {
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

function setStaticLyrics(text) {
    parsedLyrics = []; 
    lyricsContainer.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'lyric-line active';
    p.style.whiteSpace = 'pre-wrap';
    p.textContent = text;
    lyricsContainer.appendChild(p);
}

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

    parsedLyrics.forEach((line, index) => {
        const p = document.createElement('p');
        p.className = 'lyric-line';
        p.textContent = line.text;
        p.id = `line-${index}`; 
        lyricsContainer.appendChild(p);
    });
}

// Global Timeline & Synced Scroll Sync
audioPlayer.addEventListener('timeupdate', () => {
    if (!audioPlayer.duration) return;
    timelineSlider.value = Math.floor(audioPlayer.currentTime);
    timeCurrent.textContent = formatTime(audioPlayer.currentTime);

    if (parsedLyrics.length === 0) return; 

    const currentTime = audioPlayer.currentTime;
    let activeIndex = -1;

    for (let i = 0; i < parsedLyrics.length; i++) {
        if (currentTime >= parsedLyrics[i].time) {
            activeIndex = i;
        } else {
            break; 
        }
    }

    if (activeIndex !== -1 && activeIndex !== lastActiveIndex) {
        lastActiveIndex = activeIndex; 

        const allLines = lyricsContainer.querySelectorAll('.lyric-line');
        allLines.forEach(line => line.classList.remove('active'));

        const activeLineElement = document.getElementById(`line-${activeIndex}`);
        if (activeLineElement) {
            activeLineElement.classList.add('active');
            
            const containerRect = lyricsContainer.getBoundingClientRect();
            const lineRect = activeLineElement.getBoundingClientRect();
            const relativeLineTop = lineRect.top - containerRect.top;
            const targetScrollTop = lyricsContainer.scrollTop + relativeLineTop - (containerRect.height / 2) + (lineRect.height / 2);

            lyricsContainer.scrollTo({
                top: targetScrollTop,
                behavior: 'smooth'
            });
        }
    }
});

rackTrigger.addEventListener('click', (e) => {
    if (e.target.id === 'btn-reset') return;
    controlRack.classList.toggle('collapsed');
});

// 🚀 UPGRADED GLOBAL KEYBOARD SHORTCUTS CONTROLLER
window.addEventListener('keydown', (e) => {
    if (!audioPlayer.src) return;

    const key = e.key.toLowerCase();
    const isModifierActive = e.ctrlKey || e.metaKey;

    switch (key) {
        case ' ':
        case 'k':
            if (isModifierActive) return; 
            e.preventDefault(); 
            if (audioPlayer.paused) {
                audioPlayer.play();
            } else {
                audioPlayer.pause();
            }
            break;

        case 'arrowright':
        case 'l':
            e.preventDefault();
            if (isModifierActive || key === 'l') {
                forceSkipNext();
            } else {
                audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 10);
            }
            break;

        case 'arrowleft':
        case 'j':
            e.preventDefault();
            if (isModifierActive || key === 'j') {
                if (btnPrev) btnPrev.click();
            } else {
                audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 10);
            }
            break;

        case 'arrowup':
            if (isModifierActive) return; 
            e.preventDefault();
            audioPlayer.volume = Math.min(1, audioPlayer.volume + 0.05);
            triggerVolumeHUD();
            break;

        case 'arrowdown':
            if (isModifierActive) return;
            e.preventDefault();
            audioPlayer.volume = Math.max(0, audioPlayer.volume - 0.05);
            triggerVolumeHUD();
            break;

        case 'm':
            if (isModifierActive) return;
            e.preventDefault();
            audioPlayer.muted = !audioPlayer.muted;
            triggerVolumeHUD();
            break;

        default:
            break;
    }
});

// 🚀 CORE QUEUE MANAGER FUNCTIONS
function addToQueue(filename) {
    const trackData = fileMap.get(filename);
    if (!trackData) return;
    playbackQueue.push(filename);
    renderQueueUI();
}

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

        li.querySelector('.btn-remove-queue').addEventListener('click', (e) => {
            e.stopPropagation();
            playbackQueue.splice(index, 1);
            renderQueueUI();
        });
        queueList.appendChild(li);
    });
}

btnClearQueue.addEventListener('click', () => {
    playbackQueue = [];
    renderQueueUI();
});

// 🚀 CUSTOM TRACK CONTROLLER DRAWER LOGIC
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

audioPlayer.addEventListener('play', () => btnPlayToggle.textContent = "⏸");
audioPlayer.addEventListener('pause', () => btnPlayToggle.textContent = "▶");

function formatTime(secs) {
    if (isNaN(secs)) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

audioPlayer.addEventListener('durationchange', () => {
    timelineSlider.max = Math.floor(audioPlayer.duration);
    timeDuration.textContent = formatTime(audioPlayer.duration);
});

timelineSlider.addEventListener('input', () => {
    audioPlayer.currentTime = timelineSlider.value;
});

function triggerVolumeHUD() {
    const currentVol = audioPlayer.muted ? 0 : audioPlayer.volume;
    const volPercent = Math.round(currentVol * 100);

    hudPercentage.textContent = `${volPercent}%`;
    hudFill.style.width = `${volPercent}%`;

    if (audioPlayer.muted || volPercent === 0) {
        hudIcon.textContent = "🔇";
        hudFill.style.width = "0%";
        hudPercentage.textContent = "Mute";
    } else if (volPercent < 35) {
        hudIcon.textContent = "🔈";
    } else if (volPercent < 75) {
        hudIcon.textContent = "🔉";
    } else {
        hudIcon.textContent = "🔊";
    }

    volumeHUD.classList.add('visible');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
        volumeHUD.classList.remove('visible');
    }, 1500);
}

// 🚀 PLAYBACK REPEAT & SHUFFLE SYSTEM MODES
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[array[j]]] = [array[array[j]], array[i]];
    }
}

btnShuffle.addEventListener('click', () => {
    isShuffleActive = !isShuffleActive;
    if (isShuffleActive) {
        btnShuffle.classList.add('active-cyan');
        btnShuffle.title = "Shuffle Mode: ACTIVE (Click to restore sequential list order)";
        if (playbackQueue.length > 0) {
            shuffleArray(playbackQueue);
            renderQueueUI();
        }
    } else {
        btnShuffle.classList.remove('active-cyan');
        btnShuffle.title = "Shuffle Mode: OFF (Click to randomize queue)";
        if (masterQueueBackup.length > 0) {
            playbackQueue = masterQueueBackup.filter(trackKey => playbackQueue.includes(trackKey));
            renderQueueUI();
        }
    }
});

btnRepeatMode.addEventListener('click', () => {
    switch (repeatMode) {
        case 'linear':
            repeatMode = 'one';
            btnRepeatMode.textContent = "🔂";
            btnRepeatMode.classList.add('active-cyan');
            btnRepeatMode.title = "Repeat Mode: Repeat One (Click to loop the entire queue)";
            break;
        case 'one':
            repeatMode = 'all';
            btnRepeatMode.textContent = "🔁";
            btnRepeatMode.classList.remove('active-cyan');
            btnRepeatMode.classList.add('active-purple');
            btnRepeatMode.title = "Repeat Mode: Repeat Queue (Click to return to linear progression)";
            break;
        case 'all':
            repeatMode = 'linear';
            btnRepeatMode.textContent = "➡️";
            btnRepeatMode.classList.remove('active-purple');
            btnRepeatMode.title = "Repeat Mode: Linear (Click to loop single track)";
            break;
    }
});

// 🚀 CLOSED AUTOMATIC AUDIO TRACK-ENDING DISPATCHER
function handleAudioEnded() {
    // 1. Loop One Song has absolute priority on automatic end
    if (repeatMode === 'one' && currentTrackKey) {
        audioPlayer.currentTime = 0;
        audioPlayer.play().catch(err => console.log("Playback loop interrupted:", err));
        return;
    }

    // 2. Advance to next queued song item
    if (playbackQueue.length > 0) {
        const nextTrackFilename = playbackQueue.shift();
        if (repeatMode === 'all' && currentTrackKey) {
            playbackQueue.push(currentTrackKey);
        }
        renderQueueUI();
        playTrack(nextTrackFilename);
    } 
    // 3. Queue playlist wrap-around loop back
    else if (repeatMode === 'all' && currentTrackKey) {
        if (playbackHistory.length > 0) {
            const rebuildQueue = [...playbackHistory, currentTrackKey];
            playbackHistory = [];
            if (isShuffleActive) shuffleArray(rebuildQueue);
            
            const restartTrack = rebuildQueue.shift();
            playbackQueue = rebuildQueue;
            renderQueueUI();
            playTrack(restartTrack);
        } else {
            audioPlayer.currentTime = 0;
            audioPlayer.play().catch(err => console.log("Playback loop interrupted:", err));
        }
    } else {
        console.log("Terminal track playlist completed.");
        btnPlayToggle.textContent = "▶"; 
    }
}

// 🚀 HARDWARE MANUAL SKIP FORWARD LINK BUTTON CLICK
function forceSkipNext() {
    if (playbackQueue.length > 0) {
        const nextTrackFilename = playbackQueue.shift();
        if (repeatMode === 'all' && currentTrackKey) {
            playbackQueue.push(currentTrackKey);
        }
        renderQueueUI();
        playTrack(nextTrackFilename);
    } else if (repeatMode === 'all' && playbackHistory.length > 0) {
        const rebuildQueue = [...playbackHistory, currentTrackKey];
        playbackHistory = [];
        if (isShuffleActive) shuffleArray(rebuildQueue);
        
        const restartTrack = rebuildQueue.shift();
        playbackQueue = rebuildQueue;
        renderQueueUI();
        playTrack(restartTrack);
    } else {
        console.log("No more tracks in queue to skip forward to.");
        btnPlayToggle.textContent = "▶";
    }
}

// HARDWARE SKIP BACKWARD LINK BUTTON CLICK
btnPrev.addEventListener('click', () => {
    if (!audioPlayer.src) return;

    if (audioPlayer.currentTime > 3) {
        audioPlayer.currentTime = 0;
        return;
    }

    if (playbackHistory.length > 0) {
        const previousTrackFilename = playbackHistory.pop();
        if (currentTrackKey) {
            playbackQueue.unshift(currentTrackKey);
            renderQueueUI();
        }
        currentTrackKey = null; 
        playTrack(previousTrackFilename);
    } else {
        audioPlayer.currentTime = 0;
    }
});

// Clear old event layouts out and map clean runtime instances
btnNext.onclick = forceSkipNext;
audioPlayer.onended = handleAudioEnded;