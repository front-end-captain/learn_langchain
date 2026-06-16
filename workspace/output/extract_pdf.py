#!/usr/bin/env python3
"""
PDF Quarterly Report Extractor
Extracts: text, tables, metadata, and identifies key business metrics
"""

import pdfplumber
import json
import re
from collections import OrderedDict

PDF_PATH = "/workspace/data/quarterly_report.pdf"
OUTPUT_PATH = "/workspace/output/quarterly_report_extraction.json"

def extract_all_content(pdf_path):
    result = {
        "metadata": {},
        "document_structure": [],
        "full_text": "",
        "pages_text": [],
        "tables": [],
        "key_metrics": {},
        "summary": {}
    }
    
    with pdfplumber.open(pdf_path) as pdf:
        # Extract metadata
        if pdf.metadata:
            result["metadata"] = {
                "title": pdf.metadata.get("title", ""),
                "author": pdf.metadata.get("author", ""),
                "subject": pdf.metadata.get("subject", ""),
                "creator": pdf.metadata.get("creator", ""),
                "producer": pdf.metadata.get("producer", ""),
                "creation_date": str(pdf.metadata.get("creationDate", "")),
                "mod_date": str(pdf.metadata.get("modDate", "")),
            }
        
        result["metadata"]["page_count"] = len(pdf.pages)
        
        all_text = ""
        
        for i, page in enumerate(pdf.pages):
            page_num = i + 1
            page_info = {
                "page_number": page_num,
                "width": page.width,
                "height": page.height,
                "text": "",
                "structure": [],
                "tables": []
            }
            
            # Extract text
            text = page.extract_text()
            if text:
                page_info["text"] = text
                all_text += f"\n{'='*60}\n[Page {page_num}]\n{'='*60}\n\n{text}\n"
                
                # Analyze document structure from text
                lines = text.split('\n')
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    
                    # Detect headings based on patterns
                    # All caps, short lines, numbered sections, etc.
                    is_heading = False
                    heading_level = None
                    
                    # Pattern: "1.", "1.1", "Chapter 1", "Section 1", etc.
                    if re.match(r'^(\d+\.){1,3}\s+[A-Z]', line) and len(line) < 100:
                        is_heading = True
                        dots = line.count('.')
                        heading_level = min(dots, 3)
                    # Pattern: ALL CAPS (likely a title/heading)
                    elif re.match(r'^[A-Z\s\-\:\.\,]+$', line) and len(line) > 3 and len(line) < 100:
                        is_heading = True
                        heading_level = 1
                    # Pattern: Title case with short length
                    elif re.match(r'^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$', line) and len(line) < 60:
                        # Check if it looks like a heading (not a regular sentence)
                        words = line.split()
                        if len(words) <= 6 and not any(c in line for c in ['.', ',', ';', ':']):
                            is_heading = True
                            heading_level = 2
                    
                    if is_heading:
                        page_info["structure"].append({
                            "text": line,
                            "level": heading_level,
                            "type": "heading"
                        })
            
            # Extract tables
            tables = page.extract_tables()
            for j, table in enumerate(tables):
                if table:
                    table_info = {
                        "page": page_num,
                        "table_index": j + 1,
                        "rows": len(table),
                        "columns": len(table[0]) if table else 0,
                        "header": table[0] if table else [],
                        "data": table[1:] if len(table) > 1 else [],
                        "full_table": table
                    }
                    page_info["tables"].append(table_info)
                    result["tables"].append(table_info)
            
            result["pages_text"].append(page_info)
        
        result["full_text"] = all_text
    
    return result


def extract_key_metrics(text, tables):
    """Extract key business metrics from text and tables"""
    metrics = {
        "revenue": [],
        "profit": [],
        "growth_rates": [],
        "kpi": [],
        "financial_figures": [],
        "dates_periods": [],
        "percentages": [],
        "other_numbers": []
    }
    
    # Combine all text
    full_text = text if isinstance(text, str) else ""
    
    # Pattern matching for financial metrics
    patterns = {
        "revenue": [
            r'(?:revenue|营收|收入|总收入|total revenue|net revenue)[\s\:\-]*[\$￥€£]?\s*[\d,]+\.?\d*\s*(?:million|billion|亿|万|百万|千万|M|B)?',
            r'[\$￥€£]\s*[\d,]+\.?\d*\s*(?:million|billion|亿|万)?\s*(?:revenue|营收|收入)',
        ],
        "profit": [
            r'(?:profit|利润|净利润|net profit|net income|gross profit|operating profit)[\s\:\-]*[\$￥€£]?\s*[\d,]+\.?\d*\s*(?:million|billion|亿|万|百万|千万|M|B)?',
            r'[\$￥€£]\s*[\d,]+\.?\d*\s*(?:million|billion|亿|万)?\s*(?:profit|利润)',
        ],
        "growth_rates": [
            r'(?:growth|增长|increase|上升|decrease|下降|decline|减少)[\s\:\-]*[\+\-]?\s*\d+\.?\d*\s*%',
            r'[\+\-]?\s*\d+\.?\d*\s*%\s*(?:growth|增长|increase|decrease|同比|环比)',
            r'(?:YoY|year.over.year|同比|环比|CAGR)[\s\:\-]*[\+\-]?\s*\d+\.?\d*\s*%',
        ],
        "percentages": [
            r'\d+\.?\d*\s*%',
        ],
        "dates_periods": [
            r'(?:Q[1-4]|Quarter\s*[1-4])\s*\d{4}',
            r'\d{4}\s*(?:Q[1-4]|Quarter\s*[1-4])',
            r'(?:FY|fiscal year)\s*\d{4}',
            r'\d{4}\s*(?:FY|fiscal year)',
            r'(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{4}',
            r'\d{4}\s*[-/]\s*\d{4}',
        ],
    }
    
    for category, pattern_list in patterns.items():
        for pattern in pattern_list:
            matches = re.findall(pattern, full_text, re.IGNORECASE)
            if matches:
                metrics[category].extend(matches)
    
    # Extract from tables
    for table_info in tables:
        full_table = table_info.get("full_table", [])
        for row in full_table:
            for cell in row:
                if cell and isinstance(cell, str):
                    # Look for monetary values
                    money_matches = re.findall(r'[\$￥€£]?\s*[\d,]+\.?\d*\s*(?:million|billion|亿|万|M|B)?', cell, re.IGNORECASE)
                    if money_matches:
                        metrics["financial_figures"].extend(money_matches)
                    
                    # Look for percentages
                    pct_matches = re.findall(r'[\+\-]?\s*\d+\.?\d*\s*%', cell)
                    if pct_matches:
                        metrics["percentages"].extend(pct_matches)
    
    # Deduplicate
    for key in metrics:
        metrics[key] = list(set(metrics[key]))
    
    return metrics


def build_document_outline(pages_text):
    """Build a hierarchical document outline"""
    outline = []
    seen_headings = set()
    
    for page_info in pages_text:
        for struct in page_info.get("structure", []):
            heading = struct["text"].strip()
            if heading and heading not in seen_headings:
                seen_headings.add(heading)
                outline.append({
                    "page": page_info["page_number"],
                    "level": struct["level"],
                    "text": heading,
                    "type": struct["type"]
                })
    
    return outline


def format_tables_for_output(tables):
    """Format tables for readable output"""
    formatted = []
    for t in tables:
        formatted_table = {
            "page": t["page"],
            "table_index": t["table_index"],
            "dimensions": f"{t['rows']} rows x {t['columns']} columns",
            "header": t["header"],
            "data": t["data"]
        }
        formatted.append(formatted_table)
    return formatted


def main():
    print("=" * 60)
    print("PDF Quarterly Report Extractor")
    print("=" * 60)
    
    # Extract all content
    result = extract_all_content(PDF_PATH)
    
    # Extract key metrics
    result["key_metrics"] = extract_key_metrics(result["full_text"], result["tables"])
    
    # Build document outline
    result["document_structure"] = build_document_outline(result["pages_text"])
    
    # Format tables
    result["formatted_tables"] = format_tables_for_output(result["tables"])
    
    # Save to JSON
    # Remove full_text from JSON to keep it manageable (it's in the text file)
    json_output = {
        "metadata": result["metadata"],
        "document_structure": result["document_structure"],
        "key_metrics": result["key_metrics"],
        "tables": result["formatted_tables"],
        "pages_count": result["metadata"].get("page_count", len(result["pages_text"])),
    }
    
    with open(OUTPUT_PATH.replace(".json", "_structured.json"), "w", encoding="utf-8") as f:
        json.dump(json_output, f, ensure_ascii=False, indent=2)
    
    # Save full text
    with open(OUTPUT_PATH.replace(".json", "_full_text.txt"), "w", encoding="utf-8") as f:
        f.write(result["full_text"])
    
    # Print summary
    print(f"\n📄 Metadata:")
    for k, v in result["metadata"].items():
        if v:
            print(f"   {k}: {v}")
    
    print(f"\n📑 Document Structure ({len(result['document_structure'])} headings found):")
    for item in result["document_structure"]:
        indent = "  " * (item["level"] or 1)
        print(f"   {indent}[P{item['page']}] {item['text']}")
    
    print(f"\n📊 Tables Found: {len(result['tables'])}")
    for t in result["formatted_tables"]:
        print(f"   Page {t['page']}, Table {t['table_index']}: {t['dimensions']}")
        if t["header"]:
            print(f"     Header: {t['header']}")
    
    print(f"\n📈 Key Metrics:")
    for category, values in result["key_metrics"].items():
        if values:
            print(f"   {category}:")
            for v in values[:10]:  # Limit display
                print(f"     - {v}")
            if len(values) > 10:
                print(f"     ... and {len(values) - 10} more")
    
    print(f"\n✅ Results saved to:")
    print(f"   - {OUTPUT_PATH.replace('.json', '_structured.json')}")
    print(f"   - {OUTPUT_PATH.replace('.json', '_full_text.txt')}")
    
    return result


if __name__ == "__main__":
    main()
