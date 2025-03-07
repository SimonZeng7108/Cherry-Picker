document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const imageContainer = document.getElementById('image-container');
    const selectBtn = document.getElementById('select-btn');
    const skipBtn = document.getElementById('skip-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const folderSelectBtn = document.getElementById('folder-select-btn');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const progressContainer = document.querySelector('.progress-container');
    const progressHandle = document.getElementById('progress-handle');
    const progressTooltip = document.getElementById('progress-tooltip');
    const endMessage = document.getElementById('end-message');
    const noFoldersMessage = document.getElementById('no-folders-message');
    
    // Variables to store the current state
    let currentImages = [];
    let currentIndex = 0;
    let totalImages = 0;
    let lastMouseX = 0;
    let lastMouseY = 0;
    
    // Create magnifier container once
    const magnifierContainer = document.createElement('div');
    magnifierContainer.className = 'magnifier-container';
    magnifierContainer.id = 'magnifier-container';
    magnifierContainer.style.display = 'none'; // Hidden by default
    
    // Insert magnifier container at the top of the page
    const containerElement = document.querySelector('.container-fluid');
    containerElement.insertBefore(magnifierContainer, containerElement.firstChild);
    
    // Initialize by loading the first set of images
    loadImages();
    
    // Add event listeners
    selectBtn.addEventListener('click', () => selectImages(true));
    skipBtn.addEventListener('click', () => selectImages(false));
    prevBtn.addEventListener('click', navigateToPreviousImage);
    nextBtn.addEventListener('click', navigateToNextImage);
    folderSelectBtn.addEventListener('click', () => window.location.href = '/folder_select');
    
    // Add progress bar click functionality
    progressContainer.addEventListener('click', handleProgressBarClick);
    
    // Add tooltip hover
    progressContainer.addEventListener('mousemove', updateTooltipPosition);
    progressContainer.addEventListener('mouseleave', () => {
        progressTooltip.style.opacity = '0';
    });
    
    // Add keyboard navigation
    document.addEventListener('keydown', function(event) {
        // Y key for select
        if (event.key === 'y' || event.key === 'Y') {
            selectImages(true);
        }
        // N key for skip
        else if (event.key === 'n' || event.key === 'N') {
            selectImages(false);
        }
        // Left arrow key for previous image
        else if (event.key === 'ArrowLeft') {
            navigateToPreviousImage();
        }
        // Right arrow key for next image
        else if (event.key === 'ArrowRight') {
            navigateToNextImage();
        }
        // C key for cropping patch around cursor
        else if (event.key === 'c' || event.key === 'C') {
            activateCropMode();
        }
    });
    
    // Crop feature variables
    let cropMode = false;
    let cropDimensions = { width: 100, height: 100 }; // Default crop size
    let cropPosition = { x: 0, y: 0 };
    let cropElements = [];
    
    // Function to toggle crop mode
    function activateCropMode() {
        if (cropMode) {
            // Already in crop mode, disable it
            disableCropMode();
            return;
        }
        
        // Enable crop mode
        cropMode = true;
        
        // Get crop dimensions from UI inputs
        const widthInput = document.getElementById('crop-width');
        const heightInput = document.getElementById('crop-height');
        
        if (widthInput && heightInput) {
            const width = parseInt(widthInput.value);
            const height = parseInt(heightInput.value);
            
            // Validate dimensions
            if (width >= 10 && width <= 500 && height >= 10 && height <= 500) {
                cropDimensions.width = width;
                cropDimensions.height = height;
            }
        }
        
        // Set crosshair cursor on all images
        document.querySelectorAll('.card-img-top').forEach(img => {
            img.style.cursor = 'crosshair';
        });
        
        // Add message to inform user
        showActionMessage(`Crop Mode Active - Patch size: ${cropDimensions.width}×${cropDimensions.height}px - Click on an image to crop`);
    }
    
    // Function to disable crop mode
    function disableCropMode() {
        cropMode = false;
        
        // Remove any existing crop elements
        removeCropElements();
        
        // Reset cursor on all images
        document.querySelectorAll('.card-img-top').forEach(img => {
            img.style.cursor = '';
        });
        
        // Inform user
        showActionMessage('Crop Mode Deactivated');
    }
    
    // Function to create crop elements
    function createCropElements(sourceImg, x, y) {
        console.log("Creating crop patches at", x, y);
        
        // Get the source image details
        const sourceCard = sourceImg.closest('.card');
        const sourceFolder = sourceCard.getAttribute('data-folder');
        const sourcePath = sourceCard.getAttribute('data-path');
        const sourceFilename = sourcePath.split('/').pop();
        
        // Calculate center position as percentage of image dimensions
        const sourceRect = sourceImg.getBoundingClientRect();
        const xPercent = Math.max(0, Math.min(1, (x - sourceRect.left) / sourceRect.width));
        const yPercent = Math.max(0, Math.min(1, (y - sourceRect.top) / sourceRect.height));
        
        // Calculate pixel coordinates in the original image
        const pixelX = Math.round(xPercent * sourceImg.naturalWidth);
        const pixelY = Math.round(yPercent * sourceImg.naturalHeight);
        
        console.log("Sending crop request to server:", {
            folder: sourceFolder,
            path: sourcePath,
            centerX: pixelX,
            centerY: pixelY,
            width: cropDimensions.width,
            height: cropDimensions.height
        });
        
        // Show loading indicator
        showActionMessage('Sending crop request to server...');
        
        // Collect all image paths to crop
        const imagesToCrop = [];
        document.querySelectorAll('.card-img-top').forEach((img) => {
            const card = img.closest('.card');
            imagesToCrop.push({
                folder: card.getAttribute('data-folder'),
                path: card.getAttribute('data-path')
            });
        });
        
        // Send crop request to server
        fetch('/api/crop_images', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                images: imagesToCrop,
                center_x_percent: xPercent,
                center_y_percent: yPercent,
                width: cropDimensions.width,
                height: cropDimensions.height
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log("Server response:", data);
            
            if (data.status === 'success') {
                showActionMessage(`Successfully saved ${data.count} crop patches to Cherry_prune folder. A red-boxed version of the first image was also created.`);
            } else {
                showActionMessage(`Error: ${data.message}`);
            }
            
            // Automatically exit crop mode after saving
            disableCropMode();
        })
        .catch(error => {
            console.error('Error saving crops:', error);
            showActionMessage('Error saving crop patches. Check console for details.');
            
            // Exit crop mode on error
            disableCropMode();
        });
    }
    
    // Function to show action messages to the user
    function showActionMessage(message) {
        // Create or get message container
        let messageContainer = document.getElementById('action-message');
        
        if (!messageContainer) {
            messageContainer = document.createElement('div');
            messageContainer.id = 'action-message';
            messageContainer.className = 'alert alert-info position-fixed top-0 start-50 translate-middle-x mt-3';
            messageContainer.style.zIndex = '1050';
            document.body.appendChild(messageContainer);
        }
        
        // Set message
        messageContainer.textContent = message;
        messageContainer.style.display = 'block';
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            messageContainer.style.display = 'none';
        }, 3000);
    }
    
    // Helper function to draw cropped image on canvas - ensures crop doesn't go outside image bounds
    function drawCroppedImage(ctx, img, xPercent, yPercent) {
        // Calculate source coordinates using percentage positions
        let sourceX = Math.round(xPercent * img.naturalWidth - cropDimensions.width / 2);
        let sourceY = Math.round(yPercent * img.naturalHeight - cropDimensions.height / 2);
        
        // Adjust if crop would go outside the image boundaries
        if (sourceX < 0) sourceX = 0;
        if (sourceY < 0) sourceY = 0;
        if (sourceX + cropDimensions.width > img.naturalWidth) {
            sourceX = img.naturalWidth - cropDimensions.width;
        }
        if (sourceY + cropDimensions.height > img.naturalHeight) {
            sourceY = img.naturalHeight - cropDimensions.height;
        }
        
        // If the image is smaller than the crop size, use the full image
        const sourceWidth = Math.min(cropDimensions.width, img.naturalWidth);
        const sourceHeight = Math.min(cropDimensions.height, img.naturalHeight);
        
        // Make sure sourceX and sourceY are non-negative
        sourceX = Math.max(0, sourceX);
        sourceY = Math.max(0, sourceY);
        
        // Clear canvas
        ctx.clearRect(0, 0, cropDimensions.width, cropDimensions.height);
        
        // Draw the cropped portion
        ctx.drawImage(
            img,
            sourceX, sourceY, sourceWidth, sourceHeight,
            0, 0, sourceWidth, sourceHeight
        );
    }
    
    // Function to remove crop elements
    function removeCropElements() {
        cropElements.forEach(element => {
            if (element && element.parentNode) {
                element.parentNode.removeChild(element);
            }
        });
        cropElements = [];
    }
    
    // Navigation functions
    function navigateToPreviousImage() {
        if (currentIndex > 0) {
            loadImages(currentIndex - 1);
        }
    }
    
    function navigateToNextImage() {
        if (currentIndex < totalImages - 1) {
            loadImages(currentIndex + 1);
        } else {
            selectImages(false); // Skip to next if at the end
        }
    }
    
    // Simple click-to-navigate progress bar
    function handleProgressBarClick(e) {
        if (totalImages <= 1) return;
        
        // Calculate index from click position
        const targetIndex = calculateIndexFromPosition(e);
        console.log(`Clicked to load image at index: ${targetIndex}`);
        
        // Load that index if different from current
        if (targetIndex !== currentIndex) {
            loadImages(targetIndex);
        }
    }
    
    function updateTooltipPosition(e) {
        if (totalImages <= 1) return;
        
        const targetIndex = calculateIndexFromPosition(e);
        const percentage = (targetIndex / (totalImages - 1)) * 100;
        
        progressTooltip.style.left = `${percentage}%`;
        progressTooltip.textContent = `Image ${targetIndex + 1} / ${totalImages}`;
        progressTooltip.style.opacity = '1';
    }
    
    function calculateIndexFromPosition(e) {
        // Get click position relative to progress bar
        const rect = progressContainer.querySelector('.progress').getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const barWidth = rect.width;
        
        // Calculate position as percentage (0 to 1)
        const clickPosition = Math.max(0, Math.min(1, clickX / barWidth));
        
        // Map to image index (0 to totalImages-1)
        // Using Math.round for a more natural snap-to-closest-image behavior
        return Math.min(Math.round(clickPosition * (totalImages - 1)), totalImages - 1);
    }
    
    // Function to load images
    function loadImages(index) {
        // Show loading state
        imageContainer.innerHTML = generatePlaceholders();
        
        // Hide the magnifier container
        magnifierContainer.style.display = 'none';
        magnifierContainer.innerHTML = '';
        
        // Hide messages during loading
        endMessage.classList.add('d-none');
        noFoldersMessage.classList.add('d-none');
        
        // Ensure index is a valid number
        const targetIndex = (typeof index === 'number' && !isNaN(index)) ? 
                         Math.max(0, Math.min(index, totalImages - 1)) : undefined;
        
        // Fetch images from the server
        fetch(`/images${targetIndex !== undefined ? '?index=' + targetIndex : ''}`)
            .then(response => response.json())
            .then(data => {
                if (data.status === 'error') {
                    // Show error message if no folders are selected
                    noFoldersMessage.classList.remove('d-none');
                    imageContainer.innerHTML = '';
                    return;
                }
                
                if (data.status === 'end') {
                    // Show end message when all images are processed
                    endMessage.classList.remove('d-none');
                    imageContainer.innerHTML = '';
                    updateProgress(totalImages, totalImages);
                    return;
                }
                
                // Store the current data
                currentImages = data.images;
                currentIndex = data.current_index;
                totalImages = data.total_images;
                
                // Enable/disable navigation buttons
                prevBtn.disabled = currentIndex === 0;
                nextBtn.disabled = currentIndex === totalImages - 1;
                
                // Update the UI
                renderImages(data.images);
                updateProgress(currentIndex + 1, totalImages);
                
                // Initialize magnifier after images are rendered
                setTimeout(() => initMagnifier(), 300); // Small delay to ensure images are fully loaded
            })
            .catch(error => {
                console.error('Error loading images:', error);
                imageContainer.innerHTML = `
                    <div class="col-12">
                        <div class="alert alert-danger">
                            Error loading images. Please refresh the page and try again.
                        </div>
                    </div>
                `;
            });
    }
    
    // Function to render images
    function renderImages(images) {
        if (images.length === 0) {
            imageContainer.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-warning">
                        No images found for this index. Moving to the next one.
                    </div>
                </div>
            `;
            // Automatically move to the next index if no images found
            setTimeout(() => selectImages(false), 1500);
            return;
        }
        
        // Create HTML for all images
        let html = '';
        
        // First, create magnifiers for each image
        magnifierContainer.innerHTML = '';
        images.forEach(image => {
            const magnifier = document.createElement('div');
            magnifier.className = 'magnifier';
            magnifier.setAttribute('data-folder', image.folder);
            
            const label = document.createElement('div');
            label.className = 'magnifier-label';
            // Create a clear, fully-visible label
            label.textContent = image.folder_name;
            
            magnifier.appendChild(label);
            magnifierContainer.appendChild(magnifier);
        });
        
        // Then create the image grid
        images.forEach(image => {
            html += `
                <div class="col">
                    <div class="card h-100 shadow-sm image-card" data-folder="${image.folder}" data-path="${image.path}">
                        <div class="position-relative text-center">
                            <span class="image-folder-label">${image.folder_name}</span>
                            <div class="image-container">
                                <div class="image-wrapper">
                                    <img src="${image.data}" class="card-img-top" alt="${image.display_name}">
                                </div>
                            </div>
                        </div>
                        <div class="card-body">
                            <h5 class="card-title text-center">${image.display_name}</h5>
                        </div>
                    </div>
                </div>
            `;
        });
        
        imageContainer.innerHTML = html;
        
        // Setup image click handlers
        setupImageClickHandlers();
        
        // Initialize magnifier after images are rendered
        setTimeout(() => initMagnifier(), 300);
        
        // If we're in crop mode, remove modal attributes from images
        if (cropMode) {
            activateCropMode();
        }
    }
    
    // Initialize magnifying glass functionality
    function initMagnifier() {
        const imageWrappers = document.querySelectorAll('.image-wrapper');
        const magnifiers = document.querySelectorAll('.magnifier');
        const images = document.querySelectorAll('.card-img-top');
        
        // Exit if no images found
        if (images.length === 0) return;
        
        // Record natural dimensions and positions of all images
        images.forEach((img) => {
            // Ensure image is loaded properly
            if (!img.complete || img.naturalWidth === 0) {
                img.onload = function() {
                    // Re-initialize after image loads
                    initMagnifier();
                };
            }
        });
        
        // Helper function to update all magnifiers
        function updateAllMagnifiers(e, sourceIndex) {
            // Show the magnifier container if not already visible
            magnifierContainer.style.display = 'flex';
            
            const sourceImg = images[sourceIndex];
            if (!sourceImg) return;
            
            const sourceRect = sourceImg.getBoundingClientRect();
            
            // Calculate cursor position as a percentage of the displayed image dimensions
            const xPercent = Math.max(0, Math.min(1, (e.clientX - sourceRect.left) / sourceRect.width));
            const yPercent = Math.max(0, Math.min(1, (e.clientY - sourceRect.top) / sourceRect.height));
            
            // Store last mouse position for reference
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            
            // Get user-defined magnification
            const magnificationInput = document.getElementById('magnification');
            const zoomFactor = magnificationInput ? parseFloat(magnificationInput.value) : 4;
            
            // Validate zoom factor (fallback to 4 if invalid)
            const validZoomFactor = isNaN(zoomFactor) || zoomFactor < 1 || zoomFactor > 10 ? 4 : zoomFactor;
            
            // Update all magnifiers with the same relative position
            images.forEach((img, index) => {
                if (!img || !img.complete || img.naturalWidth === 0) return;
                
                const magnifier = magnifiers[index];
                if (!magnifier) return;
                
                // Get image natural dimensions 
                const imgNaturalWidth = img.naturalWidth;
                const imgNaturalHeight = img.naturalHeight;
                
                // Get magnifier dimensions
                const labelHeight = magnifier.querySelector('.magnifier-label').offsetHeight;
                const magnifierWidth = magnifier.offsetWidth;
                const magnifierHeight = magnifier.offsetHeight;
                const magnifierContentHeight = magnifierHeight - labelHeight;
                
                // Get the actual position in the image space (pixels)
                const imgX = xPercent * imgNaturalWidth;
                const imgY = yPercent * imgNaturalHeight;
                
                // Calculate the visible area dimensions in the magnified view
                const visibleAreaWidth = magnifierWidth / validZoomFactor;
                const visibleAreaHeight = magnifierContentHeight / validZoomFactor;
                
                // Calculate visible center coordinates
                const visibleCenterX = magnifierWidth / 2;
                const visibleCenterY = labelHeight + (magnifierContentHeight / 2);
                
                // Set background image
                magnifier.style.backgroundImage = `url(${img.src})`;
                
                // Calculate background size (accounting for zoom)
                const bgWidth = imgNaturalWidth * validZoomFactor;
                const bgHeight = imgNaturalHeight * validZoomFactor;
                magnifier.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
                
                // Calculate the background position
                // We want to center the magnified view exactly on the cursor position (imgX, imgY)
                // To do this, we need to offset the background position by the difference between
                // the center of the visible area and the zoomed position of the cursor
                const bgX = visibleCenterX - (imgX * validZoomFactor);
                const bgY = visibleCenterY - (imgY * validZoomFactor);
                
                // Apply the background position
                magnifier.style.backgroundPosition = `${bgX}px ${bgY}px`;
                
                // Make sure the magnifier is visible
                magnifier.style.display = 'block';
                
                // Debug: Add a crosshair at center of magnifier (for development only)
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    // Create or get the debug elements
                    let centerMarker = magnifier.querySelector('.debug-center-marker');
                    if (!centerMarker) {
                        // Create horizontal and vertical lines for a crosshair
                        centerMarker = document.createElement('div');
                        centerMarker.className = 'debug-center-marker';
                        centerMarker.style.position = 'absolute';
                        centerMarker.style.zIndex = '1000';
                        
                        const horizontal = document.createElement('div');
                        horizontal.style.position = 'absolute';
                        horizontal.style.width = '10px';
                        horizontal.style.height = '1px';
                        horizontal.style.backgroundColor = 'red';
                        
                        const vertical = document.createElement('div');
                        vertical.style.position = 'absolute';
                        vertical.style.width = '1px';
                        vertical.style.height = '10px';
                        vertical.style.backgroundColor = 'red';
                        
                        centerMarker.appendChild(horizontal);
                        centerMarker.appendChild(vertical);
                        magnifier.appendChild(centerMarker);
                    }
                    
                    // Position the crosshair at the center
                    centerMarker.style.left = `${visibleCenterX - 5}px`;
                    centerMarker.style.top = `${visibleCenterY - 5}px`;
                    
                    // Position the horizontal and vertical lines
                    const horizontal = centerMarker.querySelector('div:first-child');
                    const vertical = centerMarker.querySelector('div:last-child');
                    
                    if (horizontal && vertical) {
                        horizontal.style.left = '0px';
                        horizontal.style.top = '5px';
                        
                        vertical.style.left = '5px';
                        vertical.style.top = '0px';
                    }
                }
            });
        }
        
        // Add mouse events to each image wrapper
        imageWrappers.forEach((wrapper, index) => {
            const image = images[index];
            if (!image) return;
            
            // Update magnifier on mouse move
            wrapper.addEventListener('mousemove', function(e) {
                updateAllMagnifiers(e, index);
            });
            
            // Hide magnifiers on mouse leave
            wrapper.addEventListener('mouseleave', function() {
                // Optional: Hide magnifiers when not hovering over any image
                // magnifiers.forEach(magnifier => {
                //    magnifier.style.display = 'none';
                // });
                // magnifierContainer.style.display = 'none';
            });
        });
    }
    
    // Function to handle selection or skipping
    function selectImages(selected) {
        // Prepare data to send to the server
        const data = {
            selected: selected,
            images: currentImages
        };
        
        // Disable buttons during processing
        selectBtn.disabled = true;
        skipBtn.disabled = true;
        
        // Add visual feedback for the button pressed
        const btn = selected ? selectBtn : skipBtn;
        btn.classList.add('btn-ripple');
        setTimeout(() => btn.classList.remove('btn-ripple'), 500);
        
        // Send selection to the server
        fetch('/select', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(response => response.json())
        .then(data => {
            // Load the next set of images
            loadImages(data.next_index);
            
            // Re-enable buttons
            selectBtn.disabled = false;
            skipBtn.disabled = false;
        })
        .catch(error => {
            console.error('Error selecting images:', error);
            
            // Re-enable buttons even on error
            selectBtn.disabled = false;
            skipBtn.disabled = false;
        });
    }
    
    // Function to update progress bar
    function updateProgress(current, total) {
        if (total <= 1) {
            progressBar.style.width = '100%';
            progressText.textContent = `${current} / ${total} images`;
            return;
        }
        
        const percentage = ((current - 1) / (total - 1)) * 100;
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `${current} / ${total} images`;
        
        // Update handle position
        progressHandle.style.left = `${percentage}%`;
    }
    
    // Function to generate loading placeholders
    function generatePlaceholders() {
        let placeholders = '';
        for (let i = 0; i < 8; i++) {
            placeholders += `
                <div class="col placeholder-glow">
                    <div class="card h-100 shadow-sm">
                        <div class="card-img-top placeholder" style="height: 180px;"></div>
                        <div class="card-body">
                            <h5 class="card-title placeholder"></h5>
                        </div>
                    </div>
                </div>
            `;
        }
        return placeholders;
    }
    
    // Handle image click events - only for crop functionality
    function setupImageClickHandlers() {
        document.querySelectorAll('.card-img-top').forEach((img, index) => {
            img.addEventListener('click', function(e) {
                // Only handle clicks when in crop mode
                if (cropMode) {
                    e.preventDefault();
                    e.stopPropagation();
                    createCropElements(this, e.clientX, e.clientY);
                }
            });
        });
    }
    
    // Add event listener to magnification input
    const magnificationInput = document.getElementById('magnification');
    if (magnificationInput) {
        magnificationInput.addEventListener('change', function() {
            // Force update of magnifier views by triggering a mousemove on the current image
            const currentlyHoveredImage = document.querySelector('.image-wrapper:hover');
            if (currentlyHoveredImage) {
                const event = new MouseEvent('mousemove', {
                    clientX: lastMouseX || 0,
                    clientY: lastMouseY || 0,
                    bubbles: true
                });
                currentlyHoveredImage.dispatchEvent(event);
            }
        });
    }
    
    // Track last mouse position for updating magnification
    document.addEventListener('mousemove', function(e) {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });
}); 