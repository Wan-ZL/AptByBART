"""
Lightweight FastAPI wrapper around the crawl4ai library.
Mimics the Crawl4AI Docker REST API on port 11235.

Usage:
  .crawl4ai-venv/bin/python scripts/crawl4ai-server.py

Endpoints:
  GET  /health          -> {"status": "ok"}
  POST /md              -> markdown + optional LLM extraction
  POST /crawl           -> full crawl with extraction config
"""

import asyncio
import json
import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import Optional

from crawl4ai import (
    AsyncWebCrawler,
    BrowserConfig,
    CrawlerRunConfig,
    LLMExtractionStrategy,
    LLMConfig,
    CacheMode,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("crawl4ai-server")

# Shared crawler instance
crawler: Optional[AsyncWebCrawler] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global crawler
    browser_cfg = BrowserConfig(headless=True, verbose=False)
    crawler = AsyncWebCrawler(config=browser_cfg)
    await crawler.start()
    logger.info("Crawl4AI browser started")
    yield
    await crawler.close()
    logger.info("Crawl4AI browser closed")


app = FastAPI(title="Crawl4AI Local Server", lifespan=lifespan)


# ---------- Models ----------

class MdRequest(BaseModel):
    url: str
    f: Optional[str] = None  # "llm" to enable LLM extraction
    q: Optional[str] = None  # extraction query / instruction
    provider: Optional[str] = "openai/gpt-4o"
    temperature: Optional[float] = 0.2


class ExtractionConfig(BaseModel):
    type: Optional[str] = None  # "llm"
    params: Optional[dict] = None


class CrawlRequest(BaseModel):
    urls: list[str] = Field(default_factory=list)
    url: Optional[str] = None
    word_count_threshold: Optional[int] = 10
    extraction_config: Optional[ExtractionConfig] = None


# ---------- Endpoints ----------

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/md")
async def md_endpoint(req: MdRequest):
    """Crawl a URL and return markdown, optionally with LLM extraction."""
    run_cfg_kwargs = dict(
        cache_mode=CacheMode.BYPASS,
        page_timeout=30000,  # 30s for JS rendering
        wait_until="networkidle",  # wait for all network requests to finish
        wait_for="css:body",  # ensure body is rendered
        delay_before_return_html=2.0,  # extra 2s for JS to render
    )

    if req.f == "llm" and req.q:
        llm_cfg = LLMConfig(provider=req.provider, api_token=os.getenv("OPENAI_API_KEY"))
        extraction = LLMExtractionStrategy(
            llm_config=llm_cfg,
            instruction=req.q,
        )
        run_cfg_kwargs["extraction_strategy"] = extraction

    run_cfg = CrawlerRunConfig(**run_cfg_kwargs)
    result = await crawler.arun(url=req.url, config=run_cfg)

    return {
        "url": req.url,
        "success": result.success,
        "markdown": result.markdown.raw_markdown if result.markdown else "",
        "extracted_content": result.extracted_content or "",
        "error": result.error_message if not result.success else None,
    }


@app.post("/crawl")
async def crawl_endpoint(req: CrawlRequest):
    """Crawl one or more URLs with optional LLM extraction."""
    urls = req.urls or ([req.url] if req.url else [])
    if not urls:
        return {"error": "No URLs provided"}

    run_cfg_kwargs = dict(
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=req.word_count_threshold or 10,
        page_timeout=30000,
        wait_until="networkidle",
        wait_for="css:body",
        delay_before_return_html=2.0,
    )

    if req.extraction_config and req.extraction_config.type == "llm":
        params = req.extraction_config.params or {}
        provider = params.get("provider", "openai/gpt-4o")
        instruction = params.get("instruction", "Extract the main content.")
        llm_cfg = LLMConfig(provider=provider, api_token=os.getenv("OPENAI_API_KEY"))
        extraction = LLMExtractionStrategy(
            llm_config=llm_cfg,
            instruction=instruction,
        )
        run_cfg_kwargs["extraction_strategy"] = extraction

    run_cfg = CrawlerRunConfig(**run_cfg_kwargs)
    results = []

    for url in urls:
        try:
            result = await crawler.arun(url=url, config=run_cfg)
            results.append({
                "url": url,
                "success": result.success,
                "markdown": result.markdown.raw_markdown if result.markdown else "",
                "extracted_content": result.extracted_content or "",
                "error": result.error_message if not result.success else None,
            })
        except Exception as e:
            results.append({"url": url, "success": False, "error": str(e)})

    return {"results": results}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=11235, log_level="info")
