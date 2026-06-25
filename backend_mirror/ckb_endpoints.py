from fastapi import APIRouter
from datetime import datetime, timezone
import os

router = APIRouter()

@router.post("/trigger-scrape")
async def trigger_scrape(data: dict):
    category = data.get("category", "")
    city = data.get("city", "")
    user_id = data.get("user_id", None)
    
    if not category or not city:
        return {"error": "category and city required", "job_id": None}
    
    try:
        from supabase import create_client
        
        supabase_url = os.environ.get("SUPABASE_URL", "https://rtjmnjromqpsfqsgyfvp.supabase.co")
        supabase_key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")).strip()
        
        if not supabase_key:
            return {"error": "Supabase key not configured", "job_id": None}
        
        supabase = create_client(supabase_url, supabase_key)
        
        # Prima prova ad aggiornare job esistente
        try:
            update = supabase.table("searches").update({
                "status": "pending_user",
                "results": None,
                "created_at": datetime.now(timezone.utc).isoformat()
            }).eq("location", city).eq("category", category).execute()
            
            update_data = getattr(update, "data", None)
            if isinstance(update_data, list) and update_data:
                job_id = update_data[0].get("id")
                return {"job_id": job_id, "status": "queued", "category": category, "city": city, "message": f"Scraping riavviato per {category} a {city}"}
        except Exception:
            pass
        
        # Se non esiste, inserisce nuovo job
        row = {
            "status": "pending_user",
            "category": category,
            "location": city,
            "results": None,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        if user_id:
            row["user_id"] = str(user_id)
        
        resp = supabase.table("searches").insert(row).execute()
        data_resp = getattr(resp, "data", None)
        
        if isinstance(data_resp, list) and data_resp:
            job_id = data_resp[0].get("id")
            return {"job_id": job_id, "status": "queued", "category": category, "city": city, "message": f"Scraping avviato per {category} a {city}"}
        
        return {"error": "Insert failed", "job_id": None}
        
    except Exception as e:
        return {"error": str(e), "job_id": None}
