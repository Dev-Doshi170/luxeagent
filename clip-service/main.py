import io
import open_clip
import torch
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="LuxeAgent CLIP Embedding Service",
    description="Stand-alone microservice to generate OpenCLIP embeddings for images.",
    version="1.0.0",
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Detect device
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Loading model on device: {device} ...", flush=True)

try:
    model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")
    model.to(device)
    model.eval()
    print("Model loaded successfully.", flush=True)
except Exception as err:
    print(f"Failed to load CLIP model: {err}", flush=True)
    raise err

@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": device,
        "model": "ViT-B-32",
        "pretrained": "openai"
    }

@app.post("/embed")
async def embed_image(file: UploadFile = File(...)):
    try:
        content = await file.read()
        image = Image.open(io.BytesIO(content)).convert("RGB")
        
        # Preprocess and embed
        processed_image = preprocess(image).unsqueeze(0).to(device)
        with torch.no_grad():
            image_features = model.encode_image(processed_image)
            # Normalize embedding
            image_features /= image_features.norm(dim=-1, keepdim=True)
            
        vector = image_features.cpu().numpy().squeeze().tolist()
        return {"embedding": vector}
    except Exception as e:
        print(f"Error embedding image: {e}")
        raise HTTPException(status_code=500, detail=str(e))
