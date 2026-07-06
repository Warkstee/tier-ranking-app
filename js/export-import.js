/**
 * Export/Import Component
 * 
 * Handles ZIP-based export and import of rankings with images:
 * - Export: Creates a ZIP file containing ranking.json and all candidate images
 * - Import: Extracts ZIP, uploads images to server, loads ranking data
 */

import { state } from "./state.js";
import { showToast } from "./utils.js";
import { apiFetch } from "./auth.js";

/**
 * Export ranking as ZIP file with images
 */
export async function exportRanking() {
  try {
    const zip = new JSZip();
    
    // Prepare ranking data
    const data = {
      title: state.title,
      tiers: state.tiers,
      criteria: state.criteria,
      candidates: state.candidates,
      min: state.min,
      max: state.max
    };
    
    // Add ranking.json to ZIP
    zip.file("ranking.json", JSON.stringify(data, null, 2));
    
    // Create images folder in ZIP
    const imagesFolder = zip.folder("images");
    
    // Fetch and add each candidate image
    const imagePromises = state.candidates.map(async (candidate) => {
      if (!candidate.image) return;
      
      try {
        // Fetch the image from the server
        const response = await apiFetch(candidate.image);
        if (!response.ok) {
          console.warn(`Failed to fetch image: ${candidate.image}`);
          return;
        }
        
        const blob = await response.blob();
        
        // Extract filename from path (e.g., "./assets/candidates/atlas.svg" -> "atlas.svg")
        const filename = candidate.image.split("/").pop();
        
        // Add to ZIP
        imagesFolder.file(filename, blob);
      } catch (error) {
        console.warn(`Failed to process image ${candidate.image}:`, error);
      }
    });
    
    await Promise.all(imagePromises);
    
    // Generate ZIP blob
    const zipBlob = await zip.generateAsync({ type: "blob" });
    
    // Trigger download
    const url = URL.createObjectURL(zipBlob);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const baseName = state.currentRankingName || "ranking";
    const filename = `${baseName}-${timestamp}.zip`;
    
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast(`Exported ranking: ${filename}`);
  } catch (error) {
    console.error("Failed to export ranking:", error);
    showToast("Failed to export ranking.");
  }
}

/**
 * Import ranking from ZIP file
 */
export async function importRanking(file) {
  try {
    // Read ZIP file
    const zip = await JSZip.loadAsync(file);
    
    // Extract ranking.json
    const rankingFile = zip.file("ranking.json");
    if (!rankingFile) {
      throw new Error("Invalid ZIP file: ranking.json not found");
    }
    
    const rankingText = await rankingFile.async("text");
    const data = JSON.parse(rankingText);
    
    // Validate basic structure
    if (!data.title || !Array.isArray(data.tiers) || !Array.isArray(data.candidates)) {
      throw new Error("Invalid ranking file structure");
    }
    
    // Upload images from ZIP to server
    const imagesFolder = zip.folder("images");
    if (imagesFolder) {
      const imageFiles = [];
      imagesFolder.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) {
          imageFiles.push({ path: relativePath, entry: zipEntry });
        }
      });
      
      // Upload each image and build path mapping
      const pathMapping = {};
      for (const { path, entry } of imageFiles) {
        try {
          const arrayBuffer = await entry.async("arraybuffer");
          
          // Determine MIME type from file extension
          const ext = path.split(".").pop().toLowerCase();
          const mimeTypes = {
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
            "gif": "image/gif",
            "webp": "image/webp",
            "svg": "image/svg+xml"
          };
          const mimeType = mimeTypes[ext] || "application/octet-stream";
          
          // Create blob with correct MIME type
          const blob = new Blob([arrayBuffer], { type: mimeType });
          
          // Create FormData for upload
          const formData = new FormData();
          formData.append("image", blob, path);
          
          // Upload to server
          const response = await apiFetch("/api/uploadimg", {
            method: "POST",
            body: formData
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            console.warn(`Failed to upload image: ${path} - ${errorText}`);
            continue;
          }
          
          const result = await response.json();
          
          // Map old path to new path
          const oldPath = `./assets/candidates/${path}`;
          pathMapping[oldPath] = result.path;
        } catch (error) {
          console.warn(`Failed to process image ${path}:`, error);
        }
      }
      
      // Update candidate image paths
      data.candidates.forEach(candidate => {
        if (candidate.image && pathMapping[candidate.image]) {
          candidate.image = pathMapping[candidate.image];
        }
      });
    }
    
    // Apply the imported data to state
    state.title = data.title || "S-Tier Ranking Board";
    state.tiers = data.tiers || [
      { id: "tier-1", name: "S", position: 1 },
      { id: "tier-2", name: "A", position: 2 },
      { id: "tier-3", name: "B", position: 3 },
      { id: "tier-4", name: "C", position: 4 },
      { id: "tier-5", name: "D", position: 5 },
      { id: "tier-6", name: "F", position: 6 }
    ];
    state.criteria = data.criteria || [];
    state.candidates = data.candidates || [];
    state.min = data.min ?? 0;
    state.max = data.max ?? 10;
    state.currentRankingName = null; // Imported files start unsaved
    
    showToast(`Imported ranking: ${file.name}`);
    return true;
  } catch (error) {
    console.error("Failed to import ranking:", error);
    showToast("Failed to import ranking. Invalid file format.");
    return false;
  }
}
