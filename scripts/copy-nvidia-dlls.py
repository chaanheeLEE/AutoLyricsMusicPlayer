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

def main():
    dest_dir = sys.argv[1] if len(sys.argv) > 1 else "temp_nvidia_dlls"
    if os.path.exists(dest_dir):
        shutil.rmtree(dest_dir)
    os.makedirs(dest_dir, exist_ok=True)
    
    packages = ["nvidia.cublas", "nvidia.cudnn"]
    copied_count = 0
    
    for pkg in packages:
        pkg_path = find_package_path(pkg)
        if not pkg_path:
            print(f"Warning: Package {pkg} not found.")
            continue
        
        print(f"Searching for DLLs in {pkg} ({pkg_path})...")
        for root, dirs, files in os.walk(pkg_path):
            for file in files:
                if file.lower().endswith(".dll"):
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
                    
    print(f"Successfully copied {copied_count} DLLs to {os.path.join(dest_dir, 'nvidia')}")

if __name__ == "__main__":
    main()
