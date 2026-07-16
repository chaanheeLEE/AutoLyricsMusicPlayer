import os
import sys
import shutil
import importlib.util

def find_package_path(package_name):
    try:
        spec = importlib.util.find_spec(package_name)
        if spec and spec.submodule_search_locations:
            return spec.submodule_search_locations[0]
    except Exception as e:
        print(f"Error finding spec for {package_name}: {e}")
    return None

def is_whitelisted(filename):
    name = filename.lower()
    # List of essential CUDA/cuDNN DLLs needed for Whisper inference
    if "cublas64" in name or "cublaslt64" in name:
        return True
    if "cudnn64" in name:
        return True
    if "cudnn_ops_infer" in name:
        return True
    if "cudnn_cnn_infer" in name:
        return True
    if "zlibwapi" in name:
        return True
    return False

def main():
    dest_dir = sys.argv[1] if len(sys.argv) > 1 else "temp_nvidia_dlls"
    if os.path.exists(dest_dir):
        shutil.rmtree(dest_dir)
    os.makedirs(dest_dir, exist_ok=True)
    
    packages = ["nvidia.cublas", "nvidia.cudnn"]
    copied_count = 0
    
    # 1. Copy whitelisted DLLs from nvidia.cublas and nvidia.cudnn
    for pkg in packages:
        pkg_path = find_package_path(pkg)
        if not pkg_path:
            print(f"Warning: Package {pkg} not found.")
            continue
        
        print(f"Searching for DLLs in {pkg} ({pkg_path})...")
        for root, dirs, files in os.walk(pkg_path):
            for file in files:
                if file.lower().endswith(".dll"):
                    if not is_whitelisted(file):
                        continue
                        
                    # Maintain relative path structure under 'nvidia/cublas' or 'nvidia/cudnn'
                    # pkg_path typically points to 'site-packages/nvidia/cublas'
                    # The parent of pkg_path is 'site-packages/nvidia'
                    # So relative path from 'site-packages/nvidia' will be 'cublas/bin/cublas64_12.dll' etc.
                    parent_of_pkg = os.path.dirname(pkg_path)
                    rel_path = os.path.relpath(os.path.join(root, file), parent_of_pkg)
                    
                    target_file_path = os.path.join(dest_dir, "nvidia", rel_path)
                    os.makedirs(os.path.dirname(target_file_path), exist_ok=True)
                    shutil.copy2(os.path.join(root, file), target_file_path)
                    copied_count += 1
                    
    # 2. Search and copy zlibwapi.dll from python environment paths
    conda_bin_dirs = [
        os.path.dirname(sys.executable),
        os.path.join(os.path.dirname(sys.executable), "Library", "bin"),
        os.path.join(os.path.dirname(sys.executable), "DLLs")
    ]
    for p in sys.path:
        if p:
            conda_bin_dirs.append(p)
            conda_bin_dirs.append(os.path.join(p, "Library", "bin"))
            
    zlib_found = False
    for bin_dir in conda_bin_dirs:
        if not os.path.exists(bin_dir):
            continue
        zlib_path = os.path.join(bin_dir, "zlibwapi.dll")
        if os.path.exists(zlib_path):
            target_zlib_path = os.path.join(dest_dir, "nvidia", "zlibwapi.dll")
            os.makedirs(os.path.dirname(target_zlib_path), exist_ok=True)
            shutil.copy2(zlib_path, target_zlib_path)
            print(f"Copied zlibwapi.dll from {zlib_path}")
            copied_count += 1
            zlib_found = True
            break
            
    if not zlib_found:
        print("Warning: zlibwapi.dll not found in environment paths. GPU execution might fail on some systems.")
                    
    print(f"Successfully copied {copied_count} DLLs to {os.path.join(dest_dir, 'nvidia')}")

if __name__ == "__main__":
    main()
