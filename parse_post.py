"""
LinkedIn feed post HTML parser.

Paste the full feed page HTML (or a fragment containing multiple posts) into a
file, then run:

    python parse_post.py feed.html

Each post in the feed is returned as a JSON array.
You can also import parse_feed() or parse_post_element() from other scripts.
"""

import sys
import json
import re
from bs4 import BeautifulSoup, Tag


def parse_post_element(el: Tag) -> dict:
    """Parse a single post from a BeautifulSoup element (role='listitem' div)."""

    # --- Profile URL ---
    profile_url = None
    for a in el.find_all("a", href=True):
        href = a["href"]
        if re.match(r"https://www\.linkedin\.com/in/[^/]+/?$", href):
            profile_url = href.rstrip("/")
            break

    # --- Name, verified, connection degree ---
    # LinkedIn puts these in an aria-label like "Jane Doe Verified Profile 2nd"
    name = None
    verified = False
    connection_degree = None

    aria_div = el.find("div", attrs={"aria-label": re.compile(r".+")})
    if aria_div:
        label = aria_div.get("aria-label", "")
        degree_match = re.search(r"\b(1st|2nd|3rd)\b", label)
        if degree_match:
            connection_degree = degree_match.group(1)
        verified = "Verified" in label
        # Name ends before any badge/status word:
        # e.g. "Jane Doe Verified Profile 2nd"
        # e.g. "Shibananda Mishra, Hiring Premium Profile 2nd"
        name_match = re.match(
            r"^(.+?)(?:,?\s+(?:Verified|Premium|Hiring|Profile)|\s+\d(?:st|nd|rd))",
            label,
        )
        if name_match:
            name = name_match.group(1).strip().rstrip(",")

    # --- Premium (LinkedIn bug/logo SVG = Premium badge) ---
    premium = bool(el.find("svg", id="linkedin-bug-small"))

    # --- Headline ---
    headline = None
    for p in el.find_all("p"):
        text = p.get_text(separator=" ", strip=True)
        if (
            len(text) > 30
            and not re.match(r"^\d+[hmd]\s*[•·]", text)
            and not re.match(r"^\d+\s+reaction", text, re.I)
            and not re.match(r"^\d+\s+repost", text, re.I)
            and (name is None or name not in text)
        ):
            headline = text
            break

    # --- Timestamp & visibility ---
    timestamp = None
    visibility = None
    for p in el.find_all("p"):
        raw = p.get_text(" ", strip=True)
        if re.match(r"^\d+[hmd]\s*[•·]", raw):
            ts_match = re.match(r"^(\d+[hmd])", raw)
            if ts_match:
                timestamp = ts_match.group(1)
            vis_svg = p.find("svg", attrs={"aria-label": re.compile(r"Visibility")})
            if vis_svg:
                visibility = vis_svg.get("aria-label", "").replace("Visibility: ", "").strip() or None
            break

    # --- Post text ---
    post_text = None
    text_box = el.find(attrs={"data-testid": "expandable-text-box"})
    if text_box:
        for btn in text_box.find_all("button"):
            btn.decompose()
        for br in text_box.find_all("br"):
            br.replace_with("\n")
        post_text = text_box.get_text(separator="").strip()
        post_text = re.sub(r"\n{3,}", "\n\n", post_text)

    # --- Hashtags ---
    hashtags = re.findall(r"#\w+", post_text) if post_text else []

    # --- Reactions, reposts & comments ---
    reactions_count = None
    reposts_count = None
    comments_count = None
    for span in el.find_all("span", class_="_812797c9"):
        t = span.get_text(strip=True)
        if re.match(r"^\d+\s+reaction", t, re.I):
            reactions_count = int(re.search(r"\d+", t).group())
        elif re.match(r"^\d+\s+repost", t, re.I):
            reposts_count = int(re.search(r"\d+", t).group())
        elif re.match(r"^\d+\s+comment", t, re.I):
            comments_count = int(re.search(r"\d+", t).group())

    # --- Profile image URL ---
    profile_image = None
    img = el.find("img", alt=re.compile(r"View .+?'s profile"))
    if img:
        profile_image = img.get("src")

    return {
        "poster": {
            "name": name,
            "linkedin_url": profile_url,
            "headline": headline,
            "connection_degree": connection_degree,
            "verified": verified,
            "premium": premium,
            "profile_image_url": profile_image,
        },
        "post": {
            "text": post_text,
            "hashtags": hashtags,
            "timestamp": timestamp,
            "visibility": visibility,
            "reactions": reactions_count,
            "comments": comments_count,
            "reposts": reposts_count,
        },
    }


def parse_feed(html: str) -> list[dict]:
    """
    Parse all posts from a LinkedIn feed HTML string.
    Returns a list of post dicts.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Each post lives in a div[role="listitem"]
    post_elements = soup.find_all("div", attrs={"role": "listitem"})

    # Deduplicate: keep only the outermost listitem for each post
    # (LinkedIn sometimes nests listitems for reposts/shares)
    seen_ids = set()
    top_level = []
    for el in post_elements:
        # Skip if any ancestor is already a listitem we've collected
        if any(p in top_level for p in el.parents):
            continue
        top_level.append(el)

    posts = []
    for el in top_level:
        parsed = parse_post_element(el)
        # Skip completely empty results (ads, promoted content, etc.)
        if parsed["poster"]["name"] or parsed["post"]["text"]:
            posts.append(parsed)

    return posts


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            html = f.read()
    else:
        html = sys.stdin.read()

    results = parse_feed(html)
    print(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\n// {len(results)} post(s) parsed", file=sys.stderr)


if __name__ == "__main__":
    main()
