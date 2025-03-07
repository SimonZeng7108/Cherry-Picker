from flask import Flask, render_template, request, send_from_directory, jsonify, url_for
import os
import shutil
import json
import glob
from PIL import Image, ImageDraw
import io
import base64
import sys
import getpass

app = Flask(__name__)

# Configuration
OUTPUT_FOLDER = os.path.join(os.path.abspath(os.getcwd()), 'Cherry')
PRUNE_FOLDER = os.path.join(os.path.abspath(os.getcwd()), 'Cherry_prune')

# Application state (will be reset when server restarts)
selected_folders = []
image_list = []
current_index = 0

# Detect operating system
is_windows = sys.platform.startswith('win')
is_mac = sys.platform.startswith('darwin')

# Helper function to ensure the Cherry folder exists and is accessible
def ensure_output_folder():
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)
    os.makedirs(PRUNE_FOLDER, exist_ok=True)
    return True

# Create Cherry folder if it doesn't exist
ensure_output_folder()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/folder_select')
def folder_select():
    return render_template('folder_select.html')

@app.route('/api/available_folders')
def get_available_folders():
    # Get all directories in the current path
    current_path = os.getcwd()
    try:
        entries = os.listdir(current_path)
        folders = []
        
        for entry in entries:
            full_path = os.path.join(current_path, entry)
            if os.path.isdir(full_path):
                # Don't include hidden folders (those starting with .)
                if not entry.startswith('.'):
                    # Return both name and full path for each folder
                    folders.append({
                        'name': entry,
                        'path': os.path.abspath(full_path)
                    })
        
        # Sort folders alphabetically
        folders.sort(key=lambda x: x['name'].lower())
        
        return jsonify({
            'status': 'success',
            'folders': folders
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/find_folder', methods=['POST'])
def find_folder():
    """Find a folder on the system by name, searching common locations."""
    data = request.json
    folder_name = data.get('folder_name', '')
    sample_paths = data.get('sample_paths', [])
    parent_dir = data.get('parent_dir', None)
    
    if not folder_name:
        return jsonify({'status': 'error', 'message': 'No folder name provided', 'paths': []}), 400
    
    # Initialize list to store potential paths
    found_paths = []
    
    # Special case for paths from the web root
    if parent_dir == 'web_root':
        app_dir = os.path.abspath(os.getcwd())
        potential_path = os.path.join(app_dir, folder_name)
        if os.path.exists(potential_path) and os.path.isdir(potential_path):
            found_paths.append(potential_path)
    
    # Check current directory and parent directory
    current_dir = os.path.abspath(os.getcwd())
    potential_paths = [
        os.path.join(current_dir, folder_name),
        os.path.join(os.path.dirname(current_dir), folder_name)
    ]
    
    # Add paths based on sample file paths if provided
    if sample_paths and len(sample_paths) > 0:
        # Extract potential parent folders from sample paths
        for sample_path in sample_paths:
            if '/' in sample_path and sample_path.startswith(folder_name):
                # The path format is typically "folderName/subfolder/file.ext"
                parts = sample_path.split('/')
                if len(parts) > 1 and parts[0] == folder_name:
                    # Try different common roots with the folder name
                    for drive in ["C:", "D:", "E:", "F:"]:
                        potential_paths.append(f"{drive}\\{folder_name}")
    
    # On Windows, check common drives
    if os.name == 'nt':
        for drive in ["C:", "D:", "E:", "F:"]:
            potential_paths.append(f"{drive}\\{folder_name}")
            potential_paths.append(os.path.join(f"{drive}\\Users", folder_name))
            potential_paths.append(os.path.join(f"{drive}\\Users\\{getpass.getuser()}", folder_name))
            potential_paths.append(os.path.join(f"{drive}\\Users\\{getpass.getuser()}\\Documents", folder_name))
            potential_paths.append(os.path.join(f"{drive}\\Users\\{getpass.getuser()}\\Pictures", folder_name))
            potential_paths.append(os.path.join(f"{drive}\\Users\\{getpass.getuser()}\\Downloads", folder_name))
    # On macOS/Linux, check common directories
    else:
        home_dir = os.path.expanduser("~")
        potential_paths.extend([
            os.path.join(home_dir, folder_name),
            os.path.join(home_dir, "Documents", folder_name),
            os.path.join(home_dir, "Pictures", folder_name),
            os.path.join(home_dir, "Downloads", folder_name),
            os.path.join("/", folder_name)
        ])
    
    # Look for the folder in all potential locations
    for path in potential_paths:
        try:
            if os.path.exists(path) and os.path.isdir(path):
                # Use absolute path to avoid any ambiguity
                abs_path = os.path.abspath(path)
                if abs_path not in found_paths:
                    found_paths.append(abs_path)
        except Exception as e:
            app.logger.error(f"Error checking path {path}: {str(e)}")
    
    return jsonify({
        'status': 'success',
        'paths': found_paths,
        'message': f"Found {len(found_paths)} potential paths for folder '{folder_name}'"
    })

@app.route('/api/validate_folder', methods=['POST'])
def validate_folder():
    """Validate that a folder path exists and is accessible."""
    data = request.json
    path = data.get('path', '')
    
    if not path:
        return jsonify({'status': 'error', 'message': 'No path provided'}), 400
    
    # Normalize the path
    try:
        # Handle user home directory expansion (~ on Unix)
        if path.startswith('~'):
            path = os.path.expanduser(path)
        
        # Get absolute path
        if not os.path.isabs(path):
            path = os.path.abspath(os.path.join(os.getcwd(), path))
        
        # Normalize path separators for the OS
        path = os.path.normpath(path)
        
        # Check if the path exists and is a directory
        if os.path.exists(path) and os.path.isdir(path):
            # Success - path exists and is a directory
            return jsonify({
                'status': 'success',
                'path': path,
                'message': 'Valid folder path'
            })
        else:
            # Path doesn't exist or isn't a directory
            return jsonify({
                'status': 'error',
                'message': f"Path '{path}' does not exist or is not a directory"
            }), 404
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f"Error validating path: {str(e)}"
        }), 500

@app.route('/api/select_folders', methods=['POST'])
def select_folders():
    global selected_folders, image_list, current_index
    
    data = request.json
    selected_folders = data.get('folders', [])
    
    # Validate number of folders
    if len(selected_folders) > 8:
        return jsonify({'status': 'error', 'message': 'Maximum 8 folders can be selected'}), 400
    
    if len(selected_folders) < 2:
        return jsonify({'status': 'error', 'message': 'At least 2 folders must be selected'}), 400
    
    # Normalize paths for the operating system and expand user paths (like ~ on Unix)
    normalized_folders = []
    for folder in selected_folders:
        # Handle user home directory expansion (~ on Unix)
        if folder.startswith('~'):
            folder = os.path.expanduser(folder)
        
        # Convert to absolute path if it's not already
        if not os.path.isabs(folder):
            # Try to resolve as relative to current directory
            abs_path = os.path.abspath(os.path.join(os.getcwd(), folder))
            if os.path.exists(abs_path) and os.path.isdir(abs_path):
                normalized_folders.append(abs_path)
            else:
                # Keep the original path if we can't resolve it
                normalized_folders.append(os.path.normpath(folder))
        else:
            normalized_folders.append(os.path.normpath(folder))
    
    selected_folders = normalized_folders
    
    # Validate that all folder paths exist
    non_existent_folders = []
    for folder in selected_folders:
        if not os.path.exists(folder) or not os.path.isdir(folder):
            non_existent_folders.append(folder)
    
    if non_existent_folders:
        error_message = "The following folders do not exist or are not accessible:\n"
        for folder in non_existent_folders:
            error_message += f"- {folder}\n"
        error_message += "\nPlease check that you've entered the correct paths and have permission to access these locations."
        
        return jsonify({
            'status': 'error', 
            'message': error_message
        }), 400
    
    # Check if file list was provided
    file_list = data.get('file_list', None)
    
    if file_list:
        # Use uploaded file list
        image_list = file_list
    else:
        # Generate file list based on first folder's contents
        if not selected_folders:
            return jsonify({'status': 'error', 'message': 'No folders selected'}), 400
        
        # Get all image files from the first folder
        primary_folder = selected_folders[0]
        image_list = []
        
        # Common image extensions
        extensions = ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.bmp', '*.tiff']
        
        for ext in extensions:
            image_list.extend(glob.glob(os.path.join(primary_folder, ext)))
        
        # Strip folder name to get just the filenames
        image_list = [os.path.basename(img) for img in image_list]
    
    # Reset index
    current_index = 0
    
    return jsonify({
        'status': 'success',
        'message': 'Folders selected',
        'folders': selected_folders,
        'total_images': len(image_list)
    })

@app.route('/images')
def get_images():
    global current_index, image_list, selected_folders
    
    # Check if folder selection has been made
    if not selected_folders or not image_list:
        return jsonify({
            'status': 'error',
            'message': 'No folders selected. Please go to folder selection page.'
        })
    
    # Check if index needs to be reset or updated
    index_param = request.args.get('index')
    if index_param is not None:
        try:
            requested_index = int(index_param)
            if 0 <= requested_index < len(image_list):
                current_index = requested_index
        except ValueError:
            pass
    
    # Get the current image filename
    if current_index >= len(image_list):
        return jsonify({'status': 'end', 'message': 'All images have been reviewed.'})
    
    current_image = image_list[current_index]
    
    # Collect all images from different folders
    images_data = []
    
    for folder in selected_folders:
        img_path = os.path.join(folder, current_image)
        
        if os.path.exists(img_path):
            # Extract just the folder name without the full path for display
            folder_name = os.path.basename(os.path.normpath(folder))
            
            # Create display name with just folder name (not full path)
            display_name = f"{folder_name}_{current_image}"
            
            # Encode image to base64
            try:
                with Image.open(img_path) as img:
                    # Convert to RGB if needed
                    if img.mode != 'RGB':
                        img = img.convert('RGB')
                    
                    buffered = io.BytesIO()
                    img.save(buffered, format="JPEG")
                    img_str = base64.b64encode(buffered.getvalue()).decode('utf-8')
                    
                    images_data.append({
                        'folder': folder,
                        'folder_name': folder_name,
                        'filename': current_image,
                        'path': img_path,
                        'display_name': display_name,
                        'data': f'data:image/jpeg;base64,{img_str}'
                    })
            except Exception as e:
                print(f"Error processing {img_path}: {e}")
    
    return jsonify({
        'status': 'success',
        'current_index': current_index,
        'total_images': len(image_list),
        'image_path': current_image,
        'images': images_data
    })

@app.route('/select', methods=['POST'])
def select_images():
    global current_index
    
    data = request.json
    selected = data.get('selected', False)
    
    if selected:
        # Create Cherry folder if it doesn't exist
        os.makedirs(OUTPUT_FOLDER, exist_ok=True)
        
        # Copy the images to the Cherry folder
        for image_data in data.get('images', []):
            src_path = image_data['path']
            folder_name = image_data.get('folder_name', '')
            filename = image_data.get('filename', '')
            
            # If we have both folder_name and filename, create a clean output filename
            if folder_name and filename:
                output_filename = f"{folder_name}_{filename}"
            else:
                # Fallback to the display_name if the new fields aren't available
                display_name = image_data.get('display_name', '')
                output_filename = display_name.replace(' - ', '_')
            
            # Ensure source path exists
            if not os.path.exists(src_path):
                print(f"Source file not found: {src_path}")
                continue
                
            # Remove any potentially problematic characters
            safe_filename = ''.join(c for c in output_filename if c.isalnum() or c in '._- ')
            
            # Format the destination filename with absolute path
            dest_path = os.path.join(OUTPUT_FOLDER, safe_filename)
            
            try:
                shutil.copy2(src_path, dest_path)
                print(f"Copied {src_path} to {dest_path}")
            except Exception as e:
                print(f"Error copying {src_path}: {e}")
                # Try with a more basic approach if the first attempt fails
                try:
                    with open(src_path, 'rb') as src_file:
                        with open(dest_path, 'wb') as dest_file:
                            dest_file.write(src_file.read())
                    print(f"Copied {src_path} to {dest_path} using manual file I/O")
                except Exception as inner_e:
                    print(f"Failed fallback copy for {src_path}: {inner_e}")
    
    # Move to the next image
    current_index += 1
    
    return jsonify({'status': 'success', 'next_index': current_index})

@app.route('/api/upload_file_list', methods=['POST'])
def upload_file_list():
    global image_list
    
    # Check if it's a form upload with a file
    if 'file' in request.files:
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'status': 'error', 'message': 'No selected file'}), 400
        
        if file:
            # Read the file list
            content = file.read().decode('utf-8')
            image_list = [line.strip() for line in content.splitlines() if line.strip()]
            
            return jsonify({
                'status': 'success',
                'message': 'File list uploaded',
                'total_images': len(image_list)
            })
    
    # Check if it's a JSON upload with file content
    if request.is_json:
        data = request.json
        
        if 'file_content' in data:
            content = data['file_content']
            image_list = [line.strip() for line in content.splitlines() if line.strip()]
            
            return jsonify({
                'status': 'success',
                'message': 'File list uploaded via JSON',
                'total_images': len(image_list)
            })
    
    return jsonify({'status': 'error', 'message': 'No valid file or content provided'}), 400

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

@app.route('/logo/<path:path>')
def serve_logo(path):
    return send_from_directory('logo', path)

@app.route('/cherry')
def view_cherry_folder():
    """Diagnostic endpoint to view the contents of the Cherry folder."""
    try:
        # Ensure the Cherry folder exists
        if not os.path.exists(OUTPUT_FOLDER):
            return jsonify({
                'status': 'error',
                'message': f'Cherry folder does not exist at {OUTPUT_FOLDER}',
                'abs_path': os.path.abspath(OUTPUT_FOLDER)
            })
        
        # List files in the Cherry folder
        files = []
        for file in os.listdir(OUTPUT_FOLDER):
            file_path = os.path.join(OUTPUT_FOLDER, file)
            if os.path.isfile(file_path):
                file_size = os.path.getsize(file_path)
                files.append({
                    'name': file,
                    'size': file_size,
                    'size_human': f"{file_size / 1024:.1f} KB" if file_size < 1024 * 1024 else f"{file_size / (1024 * 1024):.1f} MB",
                    'path': file_path
                })
        
        # Return diagnostic information
        return jsonify({
            'status': 'success',
            'cherry_folder': OUTPUT_FOLDER,
            'abs_path': os.path.abspath(OUTPUT_FOLDER),
            'file_count': len(files),
            'files': files
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Error accessing Cherry folder: {str(e)}',
            'cherry_folder': OUTPUT_FOLDER
        })

@app.route('/api/save_crop', methods=['POST'])
def save_crop():
    # Ensure Cherry_prune folder exists
    ensure_output_folder()
    
    try:
        data = request.json
        if not data or 'image_data' not in data or 'filename' not in data:
            return jsonify({'status': 'error', 'message': 'Missing required fields'}), 400
        
        # Decode the image from base64
        image_data = base64.b64decode(data['image_data'])
        
        # Save the image to the Cherry_prune folder
        output_path = os.path.join(PRUNE_FOLDER, data['filename'])
        
        # Open the image using PIL and save
        with Image.open(io.BytesIO(image_data)) as img:
            img.save(output_path)
        
        return jsonify({
            'status': 'success', 
            'message': 'Crop saved successfully', 
            'path': output_path
        })
        
    except Exception as e:
        print(f"Error saving crop: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/crop_images', methods=['POST'])
def crop_images():
    """
    Crops multiple images directly from the filesystem based on percentage coordinates.
    Expected JSON payload:
    {
        "images": [{"folder": "path/to/folder", "path": "path/to/image.jpg"}, ...],
        "center_x_percent": 0.5,
        "center_y_percent": 0.5,
        "width": 100,
        "height": 100
    }
    """
    # Ensure Cherry_prune folder exists
    ensure_output_folder()
    
    try:
        data = request.json
        if not data or 'images' not in data:
            return jsonify({'status': 'error', 'message': 'Missing images data'}), 400
            
        # Extract crop parameters
        center_x_percent = data.get('center_x_percent', 0.5)
        center_y_percent = data.get('center_y_percent', 0.5)
        crop_width = data.get('width', 100)
        crop_height = data.get('height', 100)
        
        # Process each image
        successful_crops = []
        errors = []
        
        # Get the first image for red box processing if available
        first_image_for_red_box = None
        if data['images'] and len(data['images']) > 0:
            first_image_for_red_box = data['images'][0]
        
        for img_data in data['images']:
            try:
                # Get image paths
                folder_path = img_data['folder']
                image_path = img_data['path']
                
                # Open the original image
                with Image.open(image_path) as img:
                    # Calculate crop coordinates
                    img_width, img_height = img.size
                    
                    # Calculate pixel coordinates based on percentages
                    center_x = int(center_x_percent * img_width)
                    center_y = int(center_y_percent * img_height)
                    
                    # Calculate crop box (left, upper, right, lower)
                    left = max(0, center_x - crop_width // 2)
                    upper = max(0, center_y - crop_height // 2)
                    
                    # Adjust if crop would go outside the image
                    if left + crop_width > img_width:
                        left = img_width - crop_width
                    if upper + crop_height > img_height:
                        upper = img_height - crop_height
                    
                    # Make sure coordinates are non-negative
                    left = max(0, left)
                    upper = max(0, upper)
                    
                    # Calculate right and lower based on width and height
                    right = min(img_width, left + crop_width)
                    lower = min(img_height, upper + crop_height)
                    
                    # Extract folder name from path
                    folder_name = os.path.basename(folder_path)
                    file_name = os.path.basename(image_path)
                    
                    # Create output filename with format: folder_name_file_name_x123y456_100x100.png
                    output_filename = f"{folder_name}_{file_name}_x{center_x}y{center_y}_{crop_width}x{crop_height}.png"
                    output_path = os.path.join(PRUNE_FOLDER, output_filename)
                    
                    # Crop the image and save
                    cropped = img.crop((left, upper, right, lower))
                    cropped.save(output_path)
                    
                    # Record success
                    successful_crops.append({
                        'original': image_path,
                        'cropped': output_path
                    })
                    
                    # If this is the first image, create a red box version
                    if first_image_for_red_box and img_data == first_image_for_red_box:
                        try:
                            # Create a copy of the original image for red box
                            red_box_img = img.copy()
                            
                            # Create a drawing context
                            draw = ImageDraw.Draw(red_box_img)
                            
                            # Draw the red box
                            draw.rectangle([(left, upper), (right, lower)], outline="red", width=3)
                            
                            # Save the image with red box
                            red_box_filename = f"{folder_name}_{file_name}_x{center_x}y{center_y}_{crop_width}x{crop_height}_red_box.png"
                            red_box_path = os.path.join(PRUNE_FOLDER, red_box_filename)
                            red_box_img.save(red_box_path)
                            
                            # Create a square version of the red box image
                            # Get image dimensions
                            width, height = img.size
                            
                            # Create a square image with the same width as the original
                            square_size = width
                            
                            # Create a new square image with white background
                            square_img = Image.new('RGB', (square_size, square_size), color='white')
                            
                            # Calculate the vertical position to place the image
                            # Try to center the red box in the square as much as possible
                            if height >= square_size:
                                # If original height is greater than or equal to the width,
                                # we need to decide which part of the image to keep
                                
                                # Calculate the optimal starting y position to center the red box
                                optimal_y = max(0, center_y - square_size // 2)
                                
                                # Make sure we don't go beyond the image bounds
                                if optimal_y + square_size > height:
                                    optimal_y = height - square_size
                                
                                # Crop the original image to the desired height
                                crop_img = red_box_img.crop((0, optimal_y, width, optimal_y + square_size))
                                
                                # Paste the cropped image onto the square canvas
                                square_img.paste(crop_img, (0, 0))
                            else:
                                # If original height is less than the width,
                                # we need to center the image vertically
                                paste_y = (square_size - height) // 2
                                
                                # Paste the original image onto the square canvas
                                square_img.paste(red_box_img, (0, paste_y))
                            
                            # Save the square image
                            square_filename = f"{folder_name}_{file_name}_x{center_x}y{center_y}_{crop_width}x{crop_height}_red_box_square.png"
                            square_path = os.path.join(PRUNE_FOLDER, square_filename)
                            square_img.save(square_path)
                            
                            # Add to successful crops
                            successful_crops.append({
                                'original': image_path,
                                'red_box': red_box_path,
                                'red_box_square': square_path
                            })
                            
                            print(f"Created red box images: {red_box_path} and {square_path}")
                        except Exception as e:
                            print(f"Error creating red box for {image_path}: {str(e)}")
                            errors.append({
                                'path': image_path,
                                'error': f"Red box error: {str(e)}"
                            })
                    
            except Exception as e:
                print(f"Error processing image {img_data.get('path', 'unknown')}: {str(e)}")
                errors.append({
                    'path': img_data.get('path', 'unknown'),
                    'error': str(e)
                })
        
        # Return results
        return jsonify({
            'status': 'success' if not errors else 'partial_success',
            'message': f'Successfully cropped {len(successful_crops)} images with red box applied to first image',
            'count': len(successful_crops),
            'crops': successful_crops,
            'errors': errors
        })
        
    except Exception as e:
        print(f"Error cropping images: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# Create templates and static folders if they don't exist
os.makedirs('templates', exist_ok=True)
os.makedirs('static', exist_ok=True)

if __name__ == '__main__':
    app.run(debug=True)
