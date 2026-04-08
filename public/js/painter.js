import { config } from './configEvent.js';

let isGenerating = false;
let currentAbortController = null;
let painterImages = [];
let referenceImages = [];
let activeReferenceUploads = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Load existing images from local storage
    loadImagesFromStorage();
    renderAllImages();
    loadSidebarSettings();

    // Add event listener to the textarea for Enter key and auto-resize
    const promptInput = document.getElementById('prompt-input');
    
    function autoResizeInput() {
        promptInput.style.height = 'auto';
        promptInput.style.height = promptInput.scrollHeight + 'px';
    }

    promptInput.addEventListener('input', autoResizeInput);

    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            generateImage();
            // Reset height after sending
            promptInput.style.height = 'auto';
        }
    });

    // Expose autoResizeInput globally so we can trigger it after setting value programmatically
    window.autoResizeInput = autoResizeInput;

    setupDragAndDrop();

    const uploadInput = document.getElementById('image-upload');
    uploadInput.addEventListener('change', handleFileUpload);

    // Save settings on change
    ['model-painter', 'image-ratio', 'image-quality'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', saveSidebarSettings);
        }
    });

    // Make functions globally accessible for onclick in HTML
    window.generateImage = generateImage;
    window.deleteImage = deleteImage;
    window.closeLightbox = closeLightbox;
    window.removeReferenceImage = removeReferenceImage;
});

function saveSidebarSettings() {
    const settings = {
        model: document.getElementById('model-painter')?.value,
        ratio: document.getElementById('image-ratio')?.value,
        quality: document.getElementById('image-quality')?.value
    };
    localStorage.setItem('painterSettings', JSON.stringify(settings));
}

function loadSidebarSettings() {
    try {
        const stored = localStorage.getItem('painterSettings');
        if (stored) {
            const settings = JSON.parse(stored);
            if (settings.model) document.getElementById('model-painter').value = settings.model;
            if (settings.ratio) document.getElementById('image-ratio').value = settings.ratio;
            if (settings.quality) document.getElementById('image-quality').value = settings.quality;
        }
    } catch (e) {
        console.error('Failed to load painter settings', e);
    }
}

function setupDragAndDrop() {
    const wrapper = document.getElementById('painter-input-wrapper');
    const promptInput = document.getElementById('prompt-input');

    // Handle drag over styling
    ['dragenter', 'dragover'].forEach(eventName => {
        wrapper.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            wrapper.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        wrapper.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            wrapper.classList.remove('drag-over');
        });
    });

    // Handle drop
    wrapper.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            void handleFiles(files);
        } else {
            const dataUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
            if (dataUrl) {
                const urlClean = dataUrl.trim();
                if (urlClean.startsWith('data:image')) {
                    void uploadReferenceDataUrl(urlClean);
                } else if (
                    urlClean.startsWith('http') ||
                    urlClean.startsWith('./painter_images/') ||
                    urlClean.startsWith('./painter_uploads/')
                ) {
                    addReferenceImage({
                        previewUrl: urlClean,
                        serverPath: urlClean
                    });
                }
            }
        }
    });
    
    // Also allow pasting images into the textarea
    promptInput.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        const files = [];
        for (const item of items) {
            if (item.type.indexOf('image/') !== -1) {
                files.push(item.getAsFile());
            }
        }
        if (files.length > 0) {
            void handleFiles(files);
        }
    });
}

function handleFileUpload(e) {
    void handleFiles(e.target.files);
    e.target.value = ''; // Reset
}

async function handleFiles(files) {
    for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;

        try {
            const uploadedImage = await uploadReferenceFile(file);
            addReferenceImage(uploadedImage);
        } catch (error) {
            console.error('Failed to upload reference image:', error);
            alert(`Failed to upload reference image: ${error.message}`);
        }
    }
}

async function uploadReferenceFile(file) {
    activeReferenceUploads += 1;

    try {
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch('/gpt/painter/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `HTTP error! status: ${response.status}`);
        }

        return {
            previewUrl: data.url,
            serverPath: data.path || data.url,
            originalName: data.originalName || file.name
        };
    } finally {
        activeReferenceUploads = Math.max(0, activeReferenceUploads - 1);
    }
}

async function uploadReferenceDataUrl(dataUrl) {
    try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const extension = (blob.type && blob.type.split('/')[1]) || 'png';
        const file = new File([blob], `pasted-image.${extension}`, {
            type: blob.type || 'image/png'
        });
        const uploadedImage = await uploadReferenceFile(file);
        addReferenceImage(uploadedImage);
    } catch (error) {
        console.error('Failed to upload dropped image data:', error);
        alert(`Failed to upload dropped image: ${error.message}`);
    }
}

function addReferenceImage(referenceImage) {
    referenceImages.push(referenceImage);
    renderReferenceImages();
}

function removeReferenceImage(index) {
    referenceImages.splice(index, 1);
    renderReferenceImages();
}

function renderReferenceImages() {
    const container = document.getElementById('image-previews');
    container.innerHTML = '';
    referenceImages.forEach((referenceImage, idx) => {
        const item = document.createElement('div');
        item.className = 'image-preview-item';
        
        const img = document.createElement('img');
        img.src = referenceImage.previewUrl || referenceImage.serverPath;
        
        const delBtn = document.createElement('button');
        delBtn.className = 'image-preview-delete';
        delBtn.innerHTML = '&times;';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            removeReferenceImage(idx);
        };
        
        item.appendChild(img);
        item.appendChild(delBtn);
        container.appendChild(item);
    });
}

function getResolution(ratioStr, qualityBaseStr) {
    const qualityBase = parseInt(qualityBaseStr, 10);
    const parts = ratioStr.split(':');
    if (parts.length !== 2) return `${qualityBase}x${qualityBase}`;
    
    const wRatio = parseFloat(parts[0]);
    const hRatio = parseFloat(parts[1]);
    
    let w, h;
    if (wRatio >= hRatio) {
        w = qualityBase;
        h = Math.round((qualityBase / wRatio) * hRatio);
    } else {
        h = qualityBase;
        w = Math.round((qualityBase / hRatio) * wRatio);
    }
    
    // Optional: round to nearest multiple of 8 or 64 to be safe for diffusion models
    w = Math.round(w / 64) * 64;
    h = Math.round(h / 64) * 64;
    
    return `${w}x${h}`;
}

function loadImagesFromStorage() {
    try {
        const stored = localStorage.getItem('painterImages');
        if (stored) {
            painterImages = JSON.parse(stored);
        }
    } catch (e) {
        console.error('Failed to load painter images from local storage', e);
        painterImages = [];
    }
}

function saveImagesToStorage() {
    try {
        localStorage.setItem('painterImages', JSON.stringify(painterImages));
    } catch (e) {
        console.error('Failed to save painter images to local storage', e);
        alert('Failed to save image locally (localStorage limit might be reached).');
    }
}

function renderAllImages() {
    const container = document.getElementById('images-container');
    container.innerHTML = '';
    // Render in reverse chronological order (newest first)
    const reversed = [...painterImages].reverse();
    reversed.forEach(imgData => {
        container.appendChild(createImageCard(imgData));
    });
}

async function generateImage() {
    if (isGenerating) return;
    if (activeReferenceUploads > 0) {
        alert('Reference image is still uploading. Please wait a moment and try again.');
        return;
    }

    const promptInput = document.getElementById('prompt-input');
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    const modelSelect = document.getElementById('model-painter');
    const ratioSelect = document.getElementById('image-ratio');
    const qualitySelect = document.getElementById('image-quality');
    const model = modelSelect.value;
    
    let size = '1024x1024';
    if (ratioSelect && qualitySelect) {
        size = getResolution(ratioSelect.value, qualitySelect.value);
    }

    const apiUrl = config.urlPainter || "https://api.openai-hk.com";
    const apiKey = config.apikeyPainter || "";

    if (!apiKey) {
        alert("Please set your Painter API key in the config (top right).");
        return;
    }

    isGenerating = true;
    currentAbortController = new AbortController();
    const btn = document.getElementById('send-button');
    const loading = document.getElementById('loading-indicator');
    
    btn.disabled = true;
    loading.classList.add('visible');
    loading.onclick = cancelGeneration;

    try {
        const requestPayload = {
            apiUrl: apiUrl,
            apiKey: apiKey,
            model: model,
            prompt: prompt,
            n: 1,
            size: size
        };
        
        if (referenceImages.length > 0) {
            const referenceImage = referenceImages[0];
            requestPayload.image = referenceImage.serverPath; // Try standard param
            requestPayload.image_url = referenceImage.serverPath; // Fallback param
        }

        const response = await fetch('/gpt/painter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestPayload),
            signal: currentAbortController.signal
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || errData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        const hasData = (data.data && data.data.length > 0) || (data.output && data.output.length > 0);
        
        if (hasData) {
            const imageUrl = extractImageUrl(data);
            
            const newImageData = {
                id: Date.now().toString() + Math.floor(Math.random() * 1000).toString(),
                url: imageUrl,
                prompt: prompt,
                model: model,
                size: size,
                timestamp: Date.now()
            };

            painterImages.push(newImageData);
            saveImagesToStorage();
            
            const container = document.getElementById('images-container');
            container.insertBefore(createImageCard(newImageData), container.firstChild);
            
            promptInput.value = ''; // Move clear here to only clear on success
            promptInput.style.height = 'auto'; // Reset height
            referenceImages = []; // Clear reference images
            renderReferenceImages(); // Update DOM to remove images
        } else {
            console.error('API response data:', data);
            throw new Error('No image returned from API. Please check your model support and API key.');
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Image generation cancelled by user.');
        } else {
            console.error('Error generating image:', error);
            alert(`Error: ${error.message}`);
        }
    } finally {
        isGenerating = false;
        currentAbortController = null;
        btn.disabled = false;
        loading.classList.remove('visible');
        loading.onclick = null;
    }
}

function cancelGeneration() {
    if (isGenerating && currentAbortController) {
        currentAbortController.abort();
    }
}

function extractImageUrl(data) {
    const firstItem = Array.isArray(data?.data) ? data.data[0] : null;
    const imageUrl =
        firstItem?.url ||
        firstItem?.image_url ||
        firstItem?.imageUrl ||
        firstItem?.b64_json ||
        firstItem?.b64 ||
        data?.output?.[0]?.url ||
        data?.output?.[0]?.image_url ||
        data?.output?.[0]?.b64_json;

    if (!imageUrl) {
        console.error('Unsupported painter response payload:', data);
        throw new Error('Image response format is unsupported.');
    }

    return imageUrl;
}

function createImageCard(imgData) {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.id = `painter-img-${imgData.id}`;
    card.draggable = true;
    
    const img = document.createElement('img');
    if (typeof imgData.url === 'string' && (imgData.url.startsWith('http') || imgData.url.startsWith('./'))) {
        img.src = imgData.url;
    } else {
        // assume base64
        img.src = `data:image/png;base64,${imgData.url}`;
    }
    img.alt = imgData.prompt;

    // Drag to use as reference
    card.addEventListener('dragstart', (e) => {
        const fullImageUrl = img.src; // Handle base64 or external URL
        e.dataTransfer.setData('text/plain', fullImageUrl);
        e.dataTransfer.setData('text/uri-list', fullImageUrl);
    });

    // Double right-click to reuse prompt
    let lastRightClick = 0;
    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const now = Date.now();
        if (now - lastRightClick < 500) {
            // Double right click detected
            const promptInput = document.getElementById('prompt-input');
            promptInput.value = imgData.prompt;
            if (window.autoResizeInput) window.autoResizeInput();
            // Visual feedback
            card.style.transform = 'scale(0.95)';
            setTimeout(() => { card.style.transform = ''; }, 150);
        }
        lastRightClick = now;
    });

    // Enlarge on click
    card.style.cursor = 'zoom-in';
    card.onclick = (e) => {
        // Prevent opening if clicked on delete button (handled by stopPropagation in delBtn)
        openLightbox(img.src, imgData.prompt);
    };
    
    const overlay = document.createElement('div');
    overlay.className = 'image-card-overlay';

    const header = document.createElement('div');
    header.className = 'image-card-header';

    const meta = document.createElement('div');
    meta.className = 'image-card-meta';
    
    const sizeSpan = document.createElement('span');
    sizeSpan.textContent = imgData.size || '1024x1024';
    
    const modelSpan = document.createElement('span');
    modelSpan.className = 'model';
    modelSpan.textContent = imgData.model || 'Unknown';
    
    meta.appendChild(sizeSpan);
    meta.appendChild(modelSpan);

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.innerHTML = '&times;';
    delBtn.title = 'Delete image';
    delBtn.onclick = (e) => {
        e.stopPropagation(); // prevent opening image
        deleteImage(imgData.id);
    };

    header.appendChild(meta);
    header.appendChild(delBtn);

    const text = document.createElement('div');
    text.className = 'image-card-prompt';
    text.textContent = imgData.prompt;
    
    overlay.appendChild(header);
    overlay.appendChild(text);

    card.appendChild(img);
    card.appendChild(overlay);
    
    return card;
}

function deleteImage(id) {
    painterImages = painterImages.filter(img => img.id !== id);
    saveImagesToStorage();
    const cardElement = document.getElementById(`painter-img-${id}`);
    if (cardElement) {
        cardElement.style.opacity = '0';
        cardElement.style.transform = 'scale(0.8)';
        setTimeout(() => {
            cardElement.remove();
        }, 300);
    }
}

function openLightbox(src, prompt) {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    
    lightboxImg.src = src;
    lightboxCaption.textContent = prompt;
    lightbox.classList.add('active');
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    lightbox.classList.remove('active');
}
