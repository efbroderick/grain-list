"""Review a complete source export and publish only an explicitly checked release."""

import argparse
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

from build_grain_list_data import (
    STATE_NAMES, build_payload, cache_matches_row, geocode_rows, public_identifier, read_cache,
    split_values, write_cache,
)
from validate_grain_list_data import validate_payload, valid_web_url

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SHEET = "https://docs.google.com/spreadsheets/d/1R1j385dUU2qMtzkSsUM5inT5tTyoTbQwI0vISf1Hav8/edit"
REQUIRED = ["Record ID", "Name", "State", "Function", "Grains", "Address", "Phone", "Email", "URL", "Status", "Source", "Operational Status"]
FIELD_MAP = {
    "Name": "name", "Category": "category", "State": "state", "Function": "functions",
    "Grains": "grains", "Address": "address", "Phone": "phone", "Email": "email",
    "URL": "url", "Status": "status", "Source": "sources",
}
ISSUE_COLUMNS = ["Severity", "Record ID", "Name", "Code", "Field", "Detail", "Fingerprint", "Reviewed Exception", "Reason", "Sheet Link", "Website", "Sources"]
PLACEHOLDERS = re.compile(r"(?:example\.com|yourname@|name@domain|^test@|^email@)", re.I)
PLATFORMS = {"facebook.com", "instagram.com", "sites.google.com", "square.site", "wixsite.com", "linktr.ee"}


def read_source(path):
    with path.open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        headers = reader.fieldnames or []
        missing = set(REQUIRED) - set(headers)
        if missing or len(set(headers)) != len(headers):
            raise ValueError(f"Missing or duplicate headers. Missing: {', '.join(sorted(missing))}")
        rows = [{key: str(value or "").strip() for key, value in row.items() if key is not None} for row in reader if any(row.values())]
    if not rows:
        raise ValueError("The source contains no organizations; refusing an empty release.")
    return rows, headers


def write_csv(path, rows, headers):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def sheet_link(url, row_number, tab_id=None):
    if not url:
        return ""
    base = url.split("#", 1)[0].split("?", 1)[0]
    fragment = f"gid={tab_id}&" if tab_id is not None else ""
    return f"{base}#" + fragment + f"range=A{row_number}:O{row_number}"


def issue(row, code, field, detail, severity="warning", link=""):
    fingerprint = hashlib.sha256(json.dumps(
        [row.get("Record ID", ""), code, field, detail, row.get(field, ""),
         row.get("Name", ""), row.get("State", ""), row.get("Source", "")],
        ensure_ascii=True, separators=(",", ":"),
    ).encode()).hexdigest()[:20]
    return {"Severity": severity, "Record ID": row.get("Record ID", ""), "Name": row.get("Name", ""),
            "Code": code, "Field": field, "Detail": detail, "Fingerprint": fingerprint,
            "Reviewed Exception": "", "Reason": "", "Sheet Link": link,
            "Website": row.get("URL", ""), "Sources": row.get("Source", "")}


def address_state(address):
    cleaned = re.sub(r"\b(?:United States|USA|US)\b", "", address, flags=re.I).strip(" ,")
    matches = re.findall(r"(?:,|\s)([A-Z]{2})(?=\s*(?:,\s*)?(?:\d{5}(?:-\d{4})?)?\s*$)", cleaned)
    if matches and matches[-1] in STATE_NAMES:
        return matches[-1]
    for code, name in STATE_NAMES.items():
        if re.search(rf"(?:,|\s){re.escape(name)}(?:\s+\d{{5}}(?:-\d{{4}})?)?\s*$", cleaned, re.I):
            return code
    return ""


def active_rows(rows):
    return [row for row in rows if row.get("Operational Status", "").casefold() == "active"]


def audit(rows, allowed, cache, source_url="", tab_id=None):
    issues = []
    ids = Counter(row.get("Record ID", "") for row in rows)
    duplicate_indexes = defaultdict(list)
    for number, row in enumerate(rows, start=2):
        link = sheet_link(source_url, number, tab_id)
        def add(code, field, detail, severity="warning"):
            issues.append(issue(row, code, field, detail, severity, link))
        identifier = row.get("Record ID", "")
        if not identifier or ids[identifier] > 1:
            add("record_id", "Record ID", "Record ID is missing or repeated; updates cannot be matched safely.", "error")
        if not row.get("Name"):
            add("missing_name", "Name", "Organization name is blank.", "error")
        status = row.get("Operational Status", "").casefold()
        if status not in {"active", "closed"}:
            add("operating_status", "Operational Status", "Choose Active or Closed after review.", "error")
        if status == "closed":
            continue
        if row.get("State", "") not in STATE_NAMES:
            add("state", "State", "State must be a supported two-letter US state code.", "error")
        for field in ("Function", "Grains", "Address", "URL", "Source"):
            if not row.get(field):
                add("missing_" + field.casefold(), field, f"{field} is blank; research or record why it does not apply.")
        functions = split_values(row.get("Function", ""))
        invalid = set(functions) - allowed
        if invalid:
            add("function_vocabulary", "Function", "Unsupported Function: " + ", ".join(sorted(invalid)), "error")
        if len(functions) != len(set(functions)):
            add("repeated_function", "Function", "A Function is repeated.")
        grains = split_values(row.get("Grains", ""))
        if any(grain.casefold() == "whole wheat" for grain in grains):
            add("whole_wheat", "Grains", "Whole Wheat describes a flour/product form, not a grain variety.")
        for generic in ("Wheat", "Corn", "Rye", "Barley"):
            if generic in grains and any(grain != generic and grain.casefold().endswith(" " + generic.casefold()) for grain in grains):
                add("generic_grain", "Grains", f"{generic} appears alongside a more specific variety; review redundancy.")
        if len(grains) != len(set(grains)):
            add("repeated_grain", "Grains", "A grain value is repeated.")
        address = row.get("Address", "")
        detected = address_state(address)
        if detected and detected != row.get("State"):
            add("address_state_conflict", "Address", f"Address says {detected}; State column says {row.get('State')}.", "error")
        if row.get("Status", "").casefold() == "verified" and not row.get("Source"):
            add("verified_without_source", "Source", "Verified record has no source URL.", "error")
        for field in ("URL", "Source"):
            urls = [row[field]] if field == "URL" and row.get(field) else row.get(field, "").split(";")
            for url in filter(None, (value.strip() for value in urls)):
                if not valid_web_url(url):
                    add("invalid_" + field.casefold(), field, f"Invalid web URL: {url}", "error")
        phone = row.get("Phone", "")
        if phone and not re.fullmatch(r"\d{3}-\d{3}-\d{4}", phone):
            add("phone_format", "Phone", "Expected XXX-XXX-XXXX; review rather than silently changing the number.")
        email = row.get("Email", "")
        if email and (not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or PLACEHOLDERS.search(email)):
            add("email_format", "Email", "Invalid or placeholder email.", "error")
        cached = cache.get(identifier, {})
        if cached and not cache_matches_row(row, cached):
            add("stale_coordinates", "Address", "Cached coordinates do not match this address/state/identity, or legacy metadata is incomplete; refresh them.", "error")
        elif "latitude" not in cached:
            add("missing_coordinates", "Address", "No cached map location; geocode before publication.", "error")
        elif cached.get("precision", "address") != "address":
            add("approximate_coordinates", "Address", f"Map precision is {cached.get('precision')}; this is not a verified street location.")
        name_key = re.sub(r"[^a-z0-9]+", " ", row.get("Name", "").casefold()).strip()
        host = (urlparse(row.get("URL", "")).hostname or "").casefold().removeprefix("www.")
        for kind, value in (("name", name_key), ("website", host if host not in PLATFORMS else "")):
            if value:
                duplicate_indexes[(kind, value)].append((row, link))
        if "Last Reviewed" in row:
            reviewed = row.get("Last Reviewed", "")
            try:
                reviewed_date = datetime.strptime(reviewed, "%Y-%m-%d").date()
            except ValueError:
                add("review_date", "Last Reviewed", "Enter the last factual review date as YYYY-MM-DD.")
            else:
                age = (datetime.now(timezone.utc).date() - reviewed_date).days
                if age < 0:
                    add("review_date", "Last Reviewed", "Review date is in the future.")
                elif age > 180:
                    add("review_due", "Last Reviewed", f"Last factual review was {reviewed}; more than 180 days ago.")
    for (kind, value), matches in duplicate_indexes.items():
        if len(matches) < 2:
            continue
        for row, link in matches:
            other = ", ".join(other["Record ID"] for other, _ in matches if other is not row)
            issues.append(issue(row, "duplicate_" + kind, "Name" if kind == "name" else "URL",
                                f"Shared {kind} ({value}) with {other}; may be a legitimate related or multi-location record.", link=link))
    return issues


def changes_between(rows, published):
    old = {row["id"]: row for row in published.get("organizations", [])}
    current = {public_identifier(row["Record ID"]): row for row in active_rows(rows)}
    changes = []
    for public_id, row in current.items():
        previous = old.get(public_id)
        if previous is None:
            changes.append({"Record ID": row["Record ID"], "Name": row["Name"], "Type": "Added", "Field": "Record", "Before": "", "After": row["Name"]})
            continue
        for field, key in FIELD_MAP.items():
            after = row.get(field, "")
            if field in {"Function", "Grains"}:
                after = split_values(after)
            elif field == "Source":
                after = [url.strip() for url in after.split(";") if url.strip()]
            before = previous.get(key, [] if isinstance(after, list) else "")
            if before != after:
                changes.append({"Record ID": row["Record ID"], "Name": row["Name"], "Type": "Changed", "Field": field,
                                "Before": "; ".join(before) if isinstance(before, list) else before,
                                "After": "; ".join(after) if isinstance(after, list) else after})
    for public_id, previous in old.items():
        if public_id not in current:
            changes.append({"Record ID": "", "Name": previous["name"], "Type": "Removed", "Field": "Record", "Before": previous["name"], "After": ""})
    return changes


def apply_exceptions(issues, path):
    if not path or not path.exists():
        return issues
    with path.open(newline="", encoding="utf-8-sig") as file:
        exceptions = {(row.get("Record ID"), row.get("Code"), row.get("Fingerprint")): row.get("Reason", "").strip() for row in csv.DictReader(file)}
    for item in issues:
        reason = exceptions.get((item["Record ID"], item["Code"], item["Fingerprint"]), "")
        if reason and item["Severity"] != "error":
            item["Reviewed Exception"] = "yes"
            item["Reason"] = reason
    return issues


def check_links(rows, cache_path, max_checks=100, timeout=15, refresh=False):
    cache = read_cache(cache_path)
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    checked = 0
    results = []
    for row in active_rows(rows):
        url = row.get("URL", "")
        if not url or not valid_web_url(url):
            continue
        result = cache.get(url)
        fresh = result and datetime.fromisoformat(result["checked"]) >= cutoff
        if (refresh or not fresh) and checked < max_checks:
            try:
                response = requests.get(url, timeout=timeout, headers={"User-Agent": "GrainListMaintenance/1.0"}, stream=True)
                with response:
                    result = {"url": url, "status": response.status_code, "final_url": response.url,
                              "checked": datetime.now(timezone.utc).isoformat(), "error": ""}
            except requests.RequestException as error:
                result = {"url": url, "status": None, "final_url": "", "checked": datetime.now(timezone.utc).isoformat(), "error": type(error).__name__}
            cache[url] = result
            write_cache(cache_path, cache)
            checked += 1
        if result:
            results.append({"Record ID": row["Record ID"], "Name": row["Name"], **result})
    return results


def write_report(directory, rows, issues, changes, links, source_url):
    directory.mkdir(parents=True, exist_ok=True)
    active = active_rows(rows)
    summary = {
        "records": len(rows), "active": len(active), "closed": len(rows) - len(active),
        "missing": {field: sum(not row.get(field) for row in active) for field in ("Function", "Grains", "Address", "Phone", "Email", "URL", "Source")},
        "errors": sum(item["Severity"] == "error" for item in issues),
        "unreviewed_warnings": sum(item["Severity"] == "warning" and not item["Reviewed Exception"] for item in issues),
        "changes": len(changes), "removals": sum(change["Type"] == "Removed" for change in changes),
        "websites_checked": len(links),
        "website_checks_remaining": len({row.get("URL") for row in active if row.get("URL")}) - len({result["url"] for result in links}),
    }
    write_csv(directory / "issues.csv", issues, ISSUE_COLUMNS)
    write_csv(directory / "changes.csv", changes, ["Record ID", "Name", "Type", "Field", "Before", "After"])
    write_csv(directory / "website_checks.csv", links, ["Record ID", "Name", "url", "status", "final_url", "checked", "error"])
    write_csv(directory / "reviewed_exceptions.csv", [item for item in issues if item["Severity"] == "warning"], ["Record ID", "Name", "Code", "Fingerprint", "Reason"])
    report = {"summary": summary, "issues": issues, "changes": changes, "links": links, "source": source_url,
              "generated": datetime.now(timezone.utc).isoformat()}
    (directory / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    data = json.dumps(report).replace("<", "\\u003c")
    page = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grain List Data Review</title>
<style>body{font:14px Arial,sans-serif;margin:0;color:#202820;background:#fff}header,main{padding:20px;max-width:1500px;margin:auto}h1{font-size:26px;margin:0 0 8px}p{line-height:1.5}.counts{display:flex;flex-wrap:wrap;gap:20px;padding:16px 0;border-block:1px solid #ddd}.counts strong{font-size:22px;display:block}.missing{margin:14px 0;color:#714300}nav{display:flex;gap:6px;margin:18px 0}button,input,select{font:inherit;padding:9px;border:1px solid #aaa;background:white;border-radius:4px}button[aria-pressed=true]{background:#244b35;color:white}label{display:flex;gap:8px;align-items:center}aside{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}input{min-width:240px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:800px}th{text-align:left;background:#eee;position:sticky;top:0}td,th{padding:10px;border-bottom:1px solid #ddd;vertical-align:top}td{max-width:350px;overflow-wrap:anywhere}a{color:#245b9b}.error{color:#ad182c;font-weight:bold}.warning{color:#7c5000}small{color:#555}#count{margin-bottom:8px}footer{padding-top:20px;color:#555}</style>
<header><h1>Grain List Data Review</h1><p>Review gaps and changes before publishing. These checks identify inconsistencies; they do not prove that a business description, address, or operating status is factually correct.</p><a id="source" target="_blank" rel="noopener">Open editable source sheet</a></header>
<main><div class="counts" id="counts"></div><p class="missing" id="missing"></p><nav><button data-mode="issues" aria-pressed="true">Issues</button><button data-mode="changes" aria-pressed="false">Changes</button><button data-mode="links" aria-pressed="false">Website checks</button></nav><aside><input id="search" type="search" placeholder="Search name, ID, field, or issue" aria-label="Search report"><label>Severity <select id="severity"><option value="">All</option><option value="error">Errors</option><option value="warning">Warnings</option></select></label><label><input id="exceptions" type="checkbox" style="min-width:0">Hide reviewed exceptions</label></aside><div id="count"></div><div class="scroll"><table><thead id="head"></thead><tbody id="body"></tbody></table></div><footer>CSV downloads beside this report: issues.csv, changes.csv, website_checks.csv, reviewed_exceptions.csv. Keep record IDs unchanged. Fill Reason in the exceptions CSV only after reviewing an acceptable blank or approximation. Errors must be corrected.</footer></main>
<script id="data" type="application/json">__DATA__</script><script>
const data=JSON.parse(document.getElementById('data').textContent);let mode='issues';const $=id=>document.getElementById(id);$('source').href=data.source||'#';$('source').hidden=!data.source;
for(const [label,value] of [['Records',data.summary.records],['Active',data.summary.active],['Errors',data.summary.errors],['Unreviewed warnings',data.summary.unreviewed_warnings],['Field changes',data.summary.changes]]){const el=document.createElement('span'),n=document.createElement('strong');n.textContent=value;el.append(n,document.createTextNode(label));$('counts').append(el)}
$('missing').textContent='Blank fields: '+Object.entries(data.summary.missing).map(([k,v])=>k+' '+v).join(' · ');
const columns={issues:['Severity','Record ID','Name','Field','Code','Detail','Reviewed Exception','Reason','Sheet Link','Website'],changes:['Type','Record ID','Name','Field','Before','After'],links:['Record ID','Name','url','status','final_url','checked','error']};
function render(){const cols=columns[mode],query=$('search').value.toLowerCase();const rows=data[mode].filter(r=>(!query||Object.values(r).join(' ').toLowerCase().includes(query))&&(mode!=='issues'||(!$('severity').value||r.Severity===$('severity').value))&&(mode!=='issues'||!$('exceptions').checked||!r['Reviewed Exception']));$('head').replaceChildren();$('body').replaceChildren();const hr=document.createElement('tr');for(const key of cols){const th=document.createElement('th');th.textContent=key;hr.append(th)}$('head').append(hr);for(const row of rows){const tr=document.createElement('tr');for(const key of cols){const td=document.createElement('td'),v=row[key]??'';if(['Sheet Link','Website','url','final_url'].includes(key)&&/^https?:\\/\\//.test(v)){const a=document.createElement('a');a.href=v;a.rel='noopener';a.target='_blank';a.textContent=key==='Sheet Link'?'Open row':v;td.append(a)}else{td.textContent=String(v)}if(key==='Severity')td.className=v;tr.append(td)}$('body').append(tr)}$('count').textContent=rows.length+' results'}
document.querySelectorAll('button[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('button[data-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render()});for(const id of ['search','severity','exceptions'])$(id).addEventListener('input',render);render();
</script></html>""".replace("__DATA__", data)
    (directory / "review.html").write_text(page, encoding="utf-8")
    return summary


def download_sheet(url, tab, credentials, output):
    try:
        import gspread
    except ImportError as error:
        raise ValueError("Install requirements-maintenance.txt for private Google Sheet downloads, or use --input with a CSV download.") from error
    client = gspread.service_account(filename=str(credentials), scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    worksheet = client.open_by_url(url).worksheet(tab)
    values = worksheet.get_all_values()
    if not values:
        raise ValueError("The selected Google Sheet tab is empty.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as file:
        csv.writer(file).writerows(values)
    return worksheet.id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", type=Path, help="Reviewed CSV downloaded from Google Sheets")
    source.add_argument("--sheet", help="Private Google Sheet URL (read-only download)")
    parser.add_argument("--tab", default="Organizations")
    parser.add_argument("--credentials", type=Path)
    parser.add_argument("--source-url", default=DEFAULT_SHEET)
    parser.add_argument("--sheet-tab-id", type=int, default=37602485)
    parser.add_argument("--published", type=Path, default=ROOT / "data/organizations.json")
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache/grain_list_geocode_cache.json")
    parser.add_argument("--report-dir", type=Path, default=ROOT / ".maintenance/latest")
    parser.add_argument("--exceptions", type=Path)
    parser.add_argument("--check-links", action="store_true", help="Optional free HTTP checks; never interpret a failed request as a closure")
    parser.add_argument("--max-checks", type=int, default=100)
    parser.add_argument("--refresh-links", action="store_true")
    parser.add_argument("--geocode", action="store_true", help="Refresh map cache with free geocoders")
    parser.add_argument("--publish", action="store_true", help="Write the candidate public JSON after every gate passes")
    parser.add_argument("--allow-removals", action="store_true", help="Confirm reviewed record removals")
    args = parser.parse_args()
    if args.max_checks < 0:
        parser.error("--max-checks must be nonnegative")
    tab_id = args.sheet_tab_id
    input_path = args.input
    if args.sheet:
        if not args.credentials:
            parser.error("--sheet needs --credentials, or download CSV and use --input")
        input_path = args.report_dir / "source.csv"
        tab_id = download_sheet(args.sheet, args.tab, args.credentials, input_path)
        args.source_url = args.sheet
    rows, headers = read_source(input_path)
    if not active_rows(rows):
        raise SystemExit("No active organizations; refusing an empty public directory.")
    cache = read_cache(args.cache)
    allowed = set(json.loads((ROOT / "config/functions.json").read_text())["allowed_functions"])
    published = json.loads(args.published.read_text()) if args.published.exists() else {"organizations": []}
    changes = changes_between(rows, published)
    initial = audit(rows, allowed, cache, args.source_url, tab_id)
    # Reject source defects before making network requests or replacing map points.
    source_errors = [item for item in initial if item["Code"] in {"record_id", "missing_name", "state", "address_state_conflict"}]
    if args.geocode and not source_errors:
        cache = geocode_rows(active_rows(rows), cache, timeout=30)
        write_cache(args.cache, cache)
    links = check_links(active_rows(rows), args.report_dir.parent / "website_cache.json", args.max_checks, refresh=args.refresh_links) if args.check_links else []
    issues = audit(rows, allowed, cache, args.source_url, tab_id)
    by_id = {row["Record ID"]: row for row in rows}
    for result in links:
        if result["error"] or (result["status"] or 0) >= 400:
            row = by_id[result["Record ID"]]
            issues.append(issue(row, "website_unreachable", "URL", f"HTTP check: {result['status'] or result['error']}. This does not establish closure."))
        elif (urlparse(result["url"]).hostname or "").removeprefix("www.") != (urlparse(result["final_url"]).hostname or "").removeprefix("www."):
            row = by_id[result["Record ID"]]
            issues.append(issue(row, "website_redirect", "URL", f"Redirected to a different host: {result['final_url']}; check organization identity."))
    issues = apply_exceptions(issues, args.exceptions)
    summary = write_report(args.report_dir, rows, issues, changes, links, args.source_url)
    print(json.dumps(summary, indent=2))
    print(f"Review: {args.report_dir / 'review.html'}")
    if not args.publish:
        print("Review only: the published dataset has not changed.")
        return
    if summary["errors"] or summary["unreviewed_warnings"]:
        raise SystemExit("Publication blocked: correct errors and review warnings in the report.")
    if summary["removals"] and not args.allow_removals:
        raise SystemExit("Publication blocked: review removals, then use --allow-removals.")
    payload = build_payload(active_rows(rows), cache)
    problems = validate_payload(payload, allowed)
    if problems:
        raise SystemExit("Publication blocked: " + "\n".join(problems))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    snapshot = args.report_dir.parent / "releases" / stamp
    snapshot.mkdir(parents=True)
    write_csv(snapshot / "source.csv", rows, headers)
    if args.published.exists():
        (snapshot / "previous.json").write_bytes(args.published.read_bytes())
    serialized = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
    (snapshot / "candidate.json").write_text(serialized, encoding="utf-8")
    manifest = {"created": stamp, "source_url": args.source_url, "source_sha256": hashlib.sha256((snapshot / "source.csv").read_bytes()).hexdigest(),
                "data_sha256": hashlib.sha256(serialized.encode()).hexdigest(), "summary": summary,
                "reviewed_exceptions": [item for item in issues if item["Reviewed Exception"]]}
    (snapshot / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    args.published.parent.mkdir(parents=True, exist_ok=True)
    temp = args.published.with_suffix(".tmp")
    temp.write_text(serialized, encoding="utf-8")
    temp.replace(args.published)
    print(f"Prepared {len(payload['organizations'])} reviewed records. Snapshot: {snapshot}")
    print("GitHub/Vercel are not changed by this script. Commit and push after previewing.")


if __name__ == "__main__":
    main()
