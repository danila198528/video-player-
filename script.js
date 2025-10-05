// ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
let videoPlayer;
let subtitlesContainer;
let englishSubtitles = [];
let russianSubtitles = [];
let syncedSubtitles = [];
let currentSubtitleMode = 'dual-column';
let subtitleInterval;
let subtitleHistory = [];
let currentSubtitleIndex = -1;

// Словарь для подсветки
let wordDictionary = {};
let wordSet = new Set();
let highlightRegex = null;
let isDictionaryLoaded = false;

// ========== ИНИЦИАЛИЗАЦИЯ ==========
document.addEventListener('DOMContentLoaded', function() {
    videoPlayer = document.getElementById('videoPlayer');
    subtitlesContainer = document.getElementById('subtitlesContainer');
    updateStatus('⚠️ Загрузите словарь чтобы разблокировать кнопку загрузки видео');
    
    videoPlayer.addEventListener('error', function(e) {
        updateStatus('Ошибка видео: ' + getVideoError(videoPlayer.error));
    });
});

// ========== ПОСТРОЕНИЕ ИНДЕКСА СЛОВ ==========
function buildWordIndex() {
    wordSet.clear();
    const allWords = [];
    
    for (const [baseWord, forms] of Object.entries(wordDictionary)) {
        forms.forEach(form => {
            const normalized = form.toLowerCase();
            wordSet.add(normalized);
            allWords.push(normalized);
        });
    }
    
    allWords.sort((a, b) => b.length - a.length);
    const escapedWords = allWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = '\\b(' + escapedWords.join('|') + ')\\b';
    highlightRegex = new RegExp(pattern, 'gi');
    
    console.log('Создан индекс:', wordSet.size, 'форм слов');
}

// ========== ЗАГРУЗКА СЛОВАРЯ ==========
function loadDictionary() {
    document.getElementById('dictionaryFile').click();
}

document.getElementById('dictionaryFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        updateStatus('Загрузка словаря...');
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                wordDictionary = JSON.parse(e.target.result);
                buildWordIndex();
                isDictionaryLoaded = true;
                
                // Разблокируем кнопку загрузки видео
                const videoBtn = document.getElementById('loadVideoBtn');
                if (videoBtn) {
                    videoBtn.disabled = false;
                }
                
                updateStatus(`✅ Словарь загружен: ${Object.keys(wordDictionary).length} слов, ${wordSet.size} форм`);
                
                if (videoPlayer.currentTime > 0) {
                    showSubtitlesAtTime(videoPlayer.currentTime);
                }
            } catch (error) {
                isDictionaryLoaded = false;
                updateStatus('❌ Ошибка: ' + error.message);
            }
        };
        reader.onerror = function() {
            isDictionaryLoaded = false;
            updateStatus('❌ Ошибка чтения файла');
        };
        reader.readAsText(file, 'UTF-8');
    }
});

// ========== ЗАГРУЗКА ВИДЕО ==========
function loadVideo() {
    if (!isDictionaryLoaded) {
        alert('Сначала загрузите словарь!');
        return;
    }
    document.getElementById('videoFile').click();
}

document.getElementById('videoFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        if (!file.type.startsWith('video/')) {
            updateStatus('Ошибка: выберите видеофайл');
            return;
        }
        
        if (subtitleInterval) {
            clearInterval(subtitleInterval);
        }
        
        const videoURL = URL.createObjectURL(file);
        videoPlayer.src = videoURL;
        updateStatus(`Видео загружено: ${file.name}`);
        
        subtitlesContainer.innerHTML = '';
        englishSubtitles = [];
        russianSubtitles = [];
        syncedSubtitles = [];
        subtitleHistory = [];
    }
});

// ========== ЗАГРУЗКА СУБТИТРОВ ==========
function loadSubtitles(lang) {
    const fileInput = lang === 'en' ? 'enSubtitleFile' : 'ruSubtitleFile';
    document.getElementById(fileInput).click();
}

document.getElementById('enSubtitleFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) parseSubtitles(file, 'en');
});

document.getElementById('ruSubtitleFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) parseSubtitles(file, 'ru');
});

function parseSubtitles(file, lang) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            let text = e.target.result;
            if (text.charCodeAt(0) === 0xFEFF) {
                text = text.substring(1);
            }
            
            const subtitles = parseSRT(text);
            
            if (lang === 'en') {
                englishSubtitles = subtitles;
                updateStatus(`Английские субтитры: ${subtitles.length} фраз`);
            } else {
                russianSubtitles = subtitles;
                updateStatus(`Русские субтитры: ${subtitles.length} фраз`);
            }
            
            if (englishSubtitles.length > 0 && russianSubtitles.length > 0) {
                syncSubtitles();
            }
            
            if (videoPlayer.src) {
                startSubtitleTracking();
                showSubtitlesAtTime(videoPlayer.currentTime);
            }
        } catch (error) {
            updateStatus('Ошибка парсинга: ' + error.message);
        }
    };
    
    reader.readAsText(file, 'UTF-8');
}

function parseSRT(data) {
    const subtitles = [];
    const normalizedData = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalizedData.split('\n\n');
    
    for (const block of blocks) {
        if (block.trim() === '') continue;
        
        const lines = block.split('\n').filter(line => line.trim() !== '');
        if (lines.length < 3) continue;
        
        let timeLineIndex = -1;
        for (let i = 0; i < Math.min(3, lines.length); i++) {
            if (lines[i].includes('-->')) {
                timeLineIndex = i;
                break;
            }
        }
        
        if (timeLineIndex === -1) continue;
        
        const timeMatch = lines[timeLineIndex].match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
        if (!timeMatch) continue;
        
        const startTime = timeToSeconds(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
        const endTime = timeToSeconds(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
        
        const textLines = lines.slice(timeLineIndex + 1);
        const text = textLines.join(' ').trim();
        
        if (text) {
            subtitles.push({ start: startTime, end: endTime, text: text });
        }
    }
    
    subtitles.sort((a, b) => a.start - b.start);
    return subtitles;
}

function timeToSeconds(hours, minutes, seconds, milliseconds) {
    let ms = parseInt(milliseconds);
    if (milliseconds.length === 2) ms = ms * 10;
    else if (milliseconds.length === 1) ms = ms * 100;
    
    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + ms / 1000;
}

// ========== СИНХРОНИЗАЦИЯ СУБТИТРОВ ==========
function syncSubtitles() {
    syncedSubtitles = [];
    const usedRussianIndexes = new Set();
    
    for (let i = 0; i < englishSubtitles.length; i++) {
        const enSub = englishSubtitles[i];
        let bestMatch = null;
        let bestMatchIndex = -1;
        let maxOverlap = 0;
        
        for (let j = 0; j < russianSubtitles.length; j++) {
            if (usedRussianIndexes.has(j)) continue;
            
            const ruSub = russianSubtitles[j];
            const overlapStart = Math.max(enSub.start, ruSub.start);
            const overlapEnd = Math.min(enSub.end, ruSub.end);
            const overlap = Math.max(0, overlapEnd - overlapStart);
            const timeDiff = Math.abs(enSub.start - ruSub.start);
            
            if (overlap > 0 || timeDiff < 3) {
                const score = overlap - timeDiff * 0.1;
                if (score > maxOverlap) {
                    maxOverlap = score;
                    bestMatch = ruSub;
                    bestMatchIndex = j;
                }
            }
        }
        
        if (bestMatchIndex !== -1) {
            usedRussianIndexes.add(bestMatchIndex);
        }
        
        syncedSubtitles.push({
            index: i,
            en: enSub.text,
            ru: bestMatch ? bestMatch.text : '',
            start: Math.min(enSub.start, bestMatch ? bestMatch.start : enSub.start),
            end: Math.max(enSub.end, bestMatch ? bestMatch.end : enSub.end)
        });
    }
    
    updateStatus(`Синхронизировано ${syncedSubtitles.length} пар`);
}

// ========== ОТСЛЕЖИВАНИЕ СУБТИТРОВ ==========
function startSubtitleTracking() {
    if (subtitleInterval) clearInterval(subtitleInterval);
    
    subtitleInterval = setInterval(() => {
        if (!videoPlayer.paused && !videoPlayer.ended) {
            showSubtitlesAtTime(videoPlayer.currentTime);
        }
    }, 100);
}

function showSubtitlesAtTime(currentTime) {
    if (syncedSubtitles.length === 0) {
        const enSub = findSubtitleAtTime(englishSubtitles, currentTime);
        const ruSub = findSubtitleAtTime(russianSubtitles, currentTime);
        renderSubtitles(enSub, ruSub);
        return;
    }
    
    let foundIndex = -1;
    for (let i = 0; i < syncedSubtitles.length; i++) {
        const pair = syncedSubtitles[i];
        if (currentTime >= pair.start - 0.1 && currentTime <= pair.end + 0.1) {
            foundIndex = i;
            break;
        }
    }
    
    if (foundIndex !== -1 && foundIndex !== currentSubtitleIndex && currentSubtitleMode === 'dual-column') {
        currentSubtitleIndex = foundIndex;
        subtitleHistory.push(foundIndex);
        
        if (subtitleHistory.length > 10) {
            subtitleHistory.shift();
        }
    } else if (foundIndex === -1) {
        currentSubtitleIndex = -1;
    }
    
    const currentPair = foundIndex !== -1 ? syncedSubtitles[foundIndex] : null;
    renderSubtitlesFromPair(currentPair);
}

function findSubtitleAtTime(subtitles, time) {
    if (!subtitles || subtitles.length === 0) return null;
    
    for (const sub of subtitles) {
        if (time >= sub.start - 0.1 && time <= sub.end + 0.1) {
            return sub;
        }
    }
    return null;
}

// ========== РЕНДЕР СУБТИТРОВ ==========
function renderSubtitlesFromPair(currentPair) {
    if (!currentPair && currentSubtitleMode !== 'dual-column') {
        subtitlesContainer.innerHTML = '';
        return;
    }
    
    let html = '';
    
    switch(currentSubtitleMode) {
        case 'english-only':
            html = currentPair ? `<div class="subtitles-single">${highlightWords(currentPair.en)}</div>` : '';
            break;
            
        case 'russian-only':
            html = currentPair ? `<div class="subtitles-single">${currentPair.ru}</div>` : '';
            break;
            
        case 'sequential':
            if (currentPair) {
                html = `
                    <div class="subtitles-sequential">
                        ${currentPair.en ? `<div class="english-text">${highlightWords(currentPair.en)}</div>` : ''}
                        ${currentPair.en && currentPair.ru ? '<div class="divider"></div>' : ''}
                        ${currentPair.ru ? `<div class="russian-text">${currentPair.ru}</div>` : ''}
                    </div>
                `;
            }
            break;
            
        case 'dual-column':
        default:
            let historyHtml = '';
            if (subtitleHistory.length > 0) {
                historyHtml = '<div class="subtitles-history">';
                const historyToShow = currentPair ? subtitleHistory.slice(0, -1) : subtitleHistory;
                
                historyToShow.forEach(pairIndex => {
                    const pair = syncedSubtitles[pairIndex];
                    if (pair) {
                        historyHtml += `
                            <div class="subtitles-history-item">
                                <div class="subtitles-dual-column">
                                    <div class="subtitles-english">${pair.en ? highlightWords(pair.en) : ''}</div>
                                    <div class="subtitles-russian">${pair.ru ? pair.ru : ''}</div>
                                </div>
                            </div>
                        `;
                    }
                });
                historyHtml += '</div>';
            }
            
            const currentHtml = currentPair ? `
                <div class="subtitles-current">
                    <div class="subtitles-dual-column">
                        <div class="subtitles-english">${currentPair.en ? highlightWords(currentPair.en) : ''}</div>
                        <div class="subtitles-russian">${currentPair.ru ? currentPair.ru : ''}</div>
                    </div>
                </div>
            ` : '';
            
            html = historyHtml + currentHtml;
            break;
    }
    
    subtitlesContainer.innerHTML = html;
    
    const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || 
                           document.mozFullScreenElement || document.msFullscreenElement);
    
    if (isFullscreen && subtitlesContainer && html) {
        subtitlesContainer.style.display = 'flex';
        subtitlesContainer.style.visibility = 'visible';
        subtitlesContainer.style.opacity = '1';
    }
}

function renderSubtitles(enSub, ruSub) {
    const enText = enSub ? enSub.text : '';
    const ruText = ruSub ? ruSub.text : '';
    
    if (!enText && !ruText) {
        subtitlesContainer.innerHTML = '';
        return;
    }
    
    let html = '';
    
    switch(currentSubtitleMode) {
        case 'english-only':
            html = `<div class="subtitles-single">${highlightWords(enText)}</div>`;
            break;
        case 'russian-only':
            html = `<div class="subtitles-single">${ruText}</div>`;
            break;
        default:
            html = `
                <div class="subtitles-dual-column">
                    <div class="subtitles-english">${enText ? highlightWords(enText) : ''}</div>
                    <div class="subtitles-russian">${ruText ? ruText : ''}</div>
                </div>
            `;
    }
    
    subtitlesContainer.innerHTML = html;
}

// ========== ПОДСВЕТКА СЛОВ ==========
function highlightWords(text) {
    if (!text || !highlightRegex) return text;
    
    return text.replace(highlightRegex, match => {
        return `<span class="highlight-word">${match}</span>`;
    });
}

// ========== УПРАВЛЕНИЕ РЕЖИМАМИ ==========
function changeSubtitleMode(mode) {
    currentSubtitleMode = mode;
    subtitleHistory = [];
    currentSubtitleIndex = -1;
    showSubtitlesAtTime(videoPlayer.currentTime);
}

// ========== ПОЛНОЭКРАННЫЙ РЕЖИМ ==========
function toggleFullscreen() {
    const container = document.getElementById('videoContainer');
    if (!container) return;
    
    if (!document.fullscreenElement) {
        const requestFullscreen = container.requestFullscreen || 
                                 container.webkitRequestFullscreen || 
                                 container.mozRequestFullScreen || 
                                 container.msRequestFullscreen;
        
        if (requestFullscreen) {
            requestFullscreen.call(container).then(() => {
                document.body.classList.add('fullscreen-mode');
                
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => {
                        showSubtitlesAtTime(videoPlayer.currentTime);
                        if (subtitlesContainer) {
                            subtitlesContainer.style.display = 'flex';
                            subtitlesContainer.style.visibility = 'visible';
                            subtitlesContainer.style.opacity = '1';
                        }
                    }, i * 200);
                }
            }).catch(err => {
                updateStatus('Ошибка fullscreen: ' + err.message);
            });
        }
    } else {
        const exitFullscreen = document.exitFullscreen || 
                              document.webkitExitFullscreen || 
                              document.mozCancelFullScreen || 
                              document.msExitFullscreen;
        
        if (exitFullscreen) {
            exitFullscreen.call(document).then(() => {
                document.body.classList.remove('fullscreen-mode');
            });
        }
    }
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
document.addEventListener('mozfullscreenchange', handleFullscreenChange);
document.addEventListener('MSFullscreenChange', handleFullscreenChange);

function handleFullscreenChange() {
    const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || 
                           document.mozFullScreenElement || document.msFullscreenElement);
    
    if (isFullscreen) {
        document.body.classList.add('fullscreen-mode');
    } else {
        document.body.classList.remove('fullscreen-mode');
    }
    
    for (let i = 0; i < 10; i++) {
        setTimeout(() => {
            showSubtitlesAtTime(videoPlayer.currentTime);
            if (subtitlesContainer) {
                subtitlesContainer.style.display = 'flex';
                subtitlesContainer.style.visibility = 'visible';
                subtitlesContainer.style.opacity = '1';
            }
        }, i * 100);
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function updateStatus(message) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = message;
    }
    console.log('Status:', message);
}

function getVideoError(error) {
    if (!error) return 'Неизвестная ошибка';
    switch (error.code) {
        case error.MEDIA_ERR_ABORTED: return 'Воспроизведение прервано';
        case error.MEDIA_ERR_NETWORK: return 'Ошибка сети';
        case error.MEDIA_ERR_DECODE: return 'Ошибка декодирования';
        case error.MEDIA_ERR_SRC_NOT_SUPPORTED: return 'Формат не поддерживается';
        default: return 'Неизвестная ошибка';
    }
}

// ========== ОБРАБОТЧИКИ СОБЫТИЙ ВИДЕО ==========
videoPlayer.addEventListener('ended', function() {
    if (subtitleInterval) clearInterval(subtitleInterval);
    subtitlesContainer.innerHTML = '';
    subtitleHistory = [];
    currentSubtitleIndex = -1;
});

videoPlayer.addEventListener('play', function() {
    if (englishSubtitles.length > 0 || russianSubtitles.length > 0) {
        startSubtitleTracking();
    }
});

videoPlayer.addEventListener('seeked', function() {
    subtitleHistory = [];
    currentSubtitleIndex = -1;
    showSubtitlesAtTime(videoPlayer.currentTime);
});