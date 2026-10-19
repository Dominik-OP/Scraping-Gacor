"""Social network analysis (SNA) of account interactions in collected X posts.

The graph is directed: an edge points from a post author to the account they
reply to, mention, quote, or repost. It only covers interactions visible in the
collected sample, not the full follower graph on X.
"""

from __future__ import annotations

import json
import math
import random
from collections import Counter, defaultdict, deque
from itertools import combinations
from typing import Any, Iterable

import geo

EDGE_TYPES = ("reply", "mention", "quote", "retweet")
# Replies and quotes signal more deliberate engagement than a passing mention.
EDGE_WEIGHTS = {"reply": 1.0, "mention": 0.6, "quote": 1.0, "retweet": 0.8}
GRAPH_NODE_LIMIT = 60
BETWEENNESS_EXACT_LIMIT = 700
BETWEENNESS_PIVOTS = 300


def load_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    try:
        loaded = json.loads(value or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    return loaded if isinstance(loaded, list) else []


def _handle(value: Any) -> str:
    return str(value or "").strip().lstrip("@")


def post_interactions(post: dict[str, Any]) -> list[tuple[str, str, str]]:
    """Return (target_username, target_display_name, edge_type) for one post."""
    author = _handle(post.get("author_username")).lower()
    found: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str]] = set()

    def add(username: Any, name: Any, kind: str) -> None:
        handle = _handle(username)
        key = (handle.lower(), kind)
        if not handle or handle.lower() in {author, "unknown"} or key in seen:
            return
        seen.add(key)
        found.append((handle, str(name or handle), kind))

    reply_to = _handle(post.get("reply_to"))
    add(reply_to, None, "reply")
    for mention in load_list(post.get("mentions_json")):
        if isinstance(mention, dict):
            username, name = mention.get("username"), mention.get("name")
        else:
            username, name = mention, None
        if _handle(username).lower() != reply_to.lower():
            add(username, name, "mention")
    add(post.get("quoted_user"), None, "quote")
    add(post.get("retweeted_user"), None, "retweet")
    return found


def pagerank(out_edges: dict[str, dict[str, float]], nodes: list[str],
             damping: float = 0.85, iterations: int = 100, tolerance: float = 1e-10) -> dict[str, float]:
    count = len(nodes)
    if not count:
        return {}
    rank = {node: 1 / count for node in nodes}
    out_weight = {node: sum(out_edges.get(node, {}).values()) for node in nodes}
    for _ in range(iterations):
        dangling = sum(rank[node] for node in nodes if not out_weight[node])
        base = (1 - damping) / count + damping * dangling / count
        updated = {node: base for node in nodes}
        for source, targets in out_edges.items():
            if not out_weight[source]:
                continue
            share = damping * rank[source] / out_weight[source]
            for target, weight in targets.items():
                updated[target] += share * weight
        delta = sum(abs(updated[node] - rank[node]) for node in nodes)
        rank = updated
        if delta < tolerance:
            break
    return rank


def betweenness(neighbors: dict[str, set[str]]) -> dict[str, float]:
    """Brandes betweenness on the undirected graph, normalized to 0–1.

    Large graphs use deterministic pivot sampling to keep requests fast.
    """
    nodes = sorted(neighbors)
    count = len(nodes)
    scores = dict.fromkeys(nodes, 0.0)
    if count < 3:
        return scores
    sources = nodes
    if count > BETWEENNESS_EXACT_LIMIT:
        ordered = sorted(nodes, key=lambda node: (-len(neighbors[node]), node))
        sources = ordered[:BETWEENNESS_PIVOTS // 2]
        rest = ordered[BETWEENNESS_PIVOTS // 2:]
        step = max(1, len(rest) // (BETWEENNESS_PIVOTS - len(sources)))
        sources += rest[::step][:BETWEENNESS_PIVOTS - len(sources)]
    for source in sources:
        stack: list[str] = []
        predecessors: dict[str, list[str]] = defaultdict(list)
        paths = dict.fromkeys(nodes, 0)
        paths[source] = 1
        distance = {source: 0}
        queue = deque([source])
        while queue:
            node = queue.popleft()
            stack.append(node)
            for neighbor in neighbors[node]:
                if neighbor not in distance:
                    distance[neighbor] = distance[node] + 1
                    queue.append(neighbor)
                if distance[neighbor] == distance[node] + 1:
                    paths[neighbor] += paths[node]
                    predecessors[neighbor].append(node)
        dependency = dict.fromkeys(nodes, 0.0)
        while stack:
            node = stack.pop()
            for predecessor in predecessors[node]:
                dependency[predecessor] += paths[predecessor] / paths[node] * (1 + dependency[node])
            if node != source:
                scores[node] += dependency[node]
    scale = count / len(sources)
    # Undirected pairs are counted from both ends.
    normalizer = (count - 1) * (count - 2)
    return {node: score * scale / normalizer for node, score in scores.items()}


def louvain(adjacency: dict[str, dict[str, float]]) -> dict[str, int]:
    """Deterministic Louvain community detection on an undirected weighted graph."""
    graph: dict[Any, dict[Any, float]] = {node: dict(edges) for node, edges in adjacency.items()}
    members: dict[Any, list[str]] = {node: [node] for node in graph}
    total = sum(sum(edges.values()) for edges in graph.values())
    if not total:
        return {node: index for index, node in enumerate(sorted(adjacency))}

    for _ in range(20):
        community, improved = _louvain_level(graph, total)
        if not improved:
            break
        aggregated: dict[Any, dict[Any, float]] = defaultdict(lambda: defaultdict(float))
        grouped: dict[Any, list[str]] = defaultdict(list)
        for node, edges in graph.items():
            group = community[node]
            grouped[group].extend(members[node])
            aggregated[group]  # Keep isolated groups.
            for neighbor, weight in edges.items():
                target = community[neighbor]
                if neighbor == node:
                    aggregated[group][group] += weight
                elif target == group:
                    aggregated[group][group] += weight / 2
                else:
                    aggregated[group][target] += weight
        graph = {node: dict(edges) for node, edges in aggregated.items()}
        members = dict(grouped)

    ordered = sorted(members.values(), key=lambda group: (-len(group), min(group)))
    return {node: index for index, group in enumerate(ordered) for node in group}


def _louvain_level(graph: dict[Any, dict[Any, float]], degree_total: float) -> tuple[dict[Any, Any], bool]:
    degree = {
        node: sum(weight for neighbor, weight in edges.items() if neighbor != node) + 2 * edges.get(node, 0.0)
        for node, edges in graph.items()
    }
    community = {node: node for node in graph}
    totals = dict(degree)
    nodes = sorted(graph, key=str)
    improved = False
    for _ in range(50):
        moved = False
        for node in nodes:
            current = community[node]
            links: dict[Any, float] = defaultdict(float)
            for neighbor, weight in graph[node].items():
                if neighbor != node:
                    links[community[neighbor]] += weight
            totals[current] -= degree[node]
            best = current
            best_gain = links.get(current, 0.0) - totals[current] * degree[node] / degree_total
            for candidate in sorted(links, key=str):
                gain = links[candidate] - totals[candidate] * degree[node] / degree_total
                if gain > best_gain + 1e-12:
                    best, best_gain = candidate, gain
            totals[best] += degree[node]
            if best != current:
                community[node] = best
                moved = improved = True
        if not moved:
            break
    return community, improved


def modularity(adjacency: dict[str, dict[str, float]], community: dict[str, int]) -> float:
    total = sum(sum(edges.values()) for edges in adjacency.values())
    if not total:
        return 0.0
    internal: Counter[int] = Counter()
    degrees: Counter[int] = Counter()
    for node, edges in adjacency.items():
        degrees[community[node]] += sum(edges.values())
        for neighbor, weight in edges.items():
            if community[neighbor] == community[node]:
                internal[community[node]] += weight
    return sum(internal[group] / total - (degrees[group] / total) ** 2 for group in degrees)


def _components(neighbors: dict[str, set[str]]) -> list[list[str]]:
    seen: set[str] = set()
    components = []
    for start in sorted(neighbors):
        if start in seen:
            continue
        queue, component = deque([start]), []
        seen.add(start)
        while queue:
            node = queue.popleft()
            component.append(node)
            for neighbor in neighbors[node]:
                if neighbor not in seen:
                    seen.add(neighbor)
                    queue.append(neighbor)
        components.append(component)
    return sorted(components, key=len, reverse=True)


def _clustering(neighbors: dict[str, set[str]]) -> float:
    values = []
    for node, adjacent in neighbors.items():
        degree = len(adjacent)
        if degree < 2:
            values.append(0.0)
            continue
        links = sum(1 for left, right in combinations(adjacent, 2) if right in neighbors[left])
        values.append(2 * links / (degree * (degree - 1)))
    return sum(values) / len(values) if values else 0.0


def _layout(nodes: list[str], edges: list[tuple[str, str, float]], community: dict[str, int],
            iterations: int = 220) -> dict[str, tuple[float, float]]:
    """Fruchterman–Reingold layout seeded by community, scaled to 0–1."""
    if not nodes:
        return {}
    if len(nodes) == 1:
        return {nodes[0]: (0.5, 0.5)}
    rng = random.Random(7)
    groups = sorted({community.get(node, -1) for node in nodes})
    centers = {
        group: (0.55 * math.cos(2 * math.pi * index / len(groups)),
                0.55 * math.sin(2 * math.pi * index / len(groups))) if len(groups) > 1 else (0.0, 0.0)
        for index, group in enumerate(groups)
    }
    position = {
        node: [centers[community.get(node, -1)][0] + rng.uniform(-0.2, 0.2),
               centers[community.get(node, -1)][1] + rng.uniform(-0.2, 0.2)]
        for node in nodes
    }
    spacing = math.sqrt(4.0 / len(nodes))
    temperature = 0.25
    for _ in range(iterations):
        displacement = {node: [0.0, 0.0] for node in nodes}
        for left, right in combinations(nodes, 2):
            dx = position[left][0] - position[right][0]
            dy = position[left][1] - position[right][1]
            distance = math.hypot(dx, dy) or 0.01
            force = spacing * spacing / distance
            displacement[left][0] += dx / distance * force
            displacement[left][1] += dy / distance * force
            displacement[right][0] -= dx / distance * force
            displacement[right][1] -= dy / distance * force
        for source, target, weight in edges:
            dx = position[source][0] - position[target][0]
            dy = position[source][1] - position[target][1]
            distance = math.hypot(dx, dy) or 0.01
            force = distance * distance / spacing * (1 + math.log1p(weight))
            displacement[source][0] -= dx / distance * force
            displacement[source][1] -= dy / distance * force
            displacement[target][0] += dx / distance * force
            displacement[target][1] += dy / distance * force
        for node in nodes:
            # Gravity keeps disconnected components on the canvas.
            displacement[node][0] -= position[node][0] * 0.6
            displacement[node][1] -= position[node][1] * 0.6
            dx, dy = displacement[node]
            length = math.hypot(dx, dy) or 1.0
            step = min(length, temperature)
            position[node][0] += dx / length * step
            position[node][1] += dy / length * step
        temperature = max(0.004, temperature * 0.975)
    xs = [point[0] for point in position.values()]
    ys = [point[1] for point in position.values()]
    width = (max(xs) - min(xs)) or 1.0
    height = (max(ys) - min(ys)) or 1.0
    return {
        node: (round(0.06 + 0.88 * (point[0] - min(xs)) / width, 4),
               round(0.08 + 0.84 * (point[1] - min(ys)) / height, 4))
        for node, point in position.items()
    }


def analyze_network(posts: Iterable[dict[str, Any]]) -> dict[str, Any]:
    posts = list(posts)
    accounts: dict[str, dict[str, Any]] = {}
    edges: dict[tuple[str, str], dict[str, Any]] = {}
    hashtags_by_author: dict[str, Counter[str]] = defaultdict(Counter)
    sentiment_by_author: dict[str, Counter[str]] = defaultdict(Counter)
    hashtag_pairs: Counter[tuple[str, str]] = Counter()
    type_counts: Counter[str] = Counter()

    def account(handle: str, name: str | None = None) -> dict[str, Any]:
        key = handle.lower()
        if key not in accounts:
            accounts[key] = {
                "username": handle, "name": name or handle, "avatar": "", "followers": 0,
                "verified": False, "posts": 0, "engagement": 0, "location": None,
                "received": Counter(),
            }
        elif name and accounts[key]["name"] == accounts[key]["username"]:
            accounts[key]["name"] = name
        return accounts[key]

    for post in posts:
        author_handle = _handle(post.get("author_username")) or "unknown"
        author_key = author_handle.lower()
        author = account(author_handle, post.get("author_name"))
        # Prefer the author's own spelling and profile over mention metadata.
        author["username"] = author_handle
        author["name"] = str(post.get("author_name") or author["name"])
        author["avatar"] = post.get("author_avatar") or author["avatar"]
        author["followers"] = max(author["followers"], int(post.get("author_followers") or 0))
        author["verified"] = author["verified"] or bool(post.get("author_verified"))
        author["posts"] += 1
        author["engagement"] += sum(int(post.get(key) or 0) for key in
                                    ("like_count", "retweet_count", "reply_count", "quote_count"))
        if author["location"] is None:
            location = geo.post_location(post)
            if location.kind != "unknown":
                author["location"] = location
        tags = sorted(set(load_list(post.get("hashtags_json"))))
        hashtags_by_author[author_key].update(tags)
        hashtag_pairs.update(combinations(tags[:12], 2))
        sentiment_by_author[author_key][post.get("sentiment") or "neutral"] += 1

        for target_handle, target_name, kind in post_interactions(post):
            target = account(target_handle, target_name)
            target["received"][kind] += 1
            key = (author_key, target_handle.lower())
            edge = edges.setdefault(key, {"weight": 0.0, "count": 0, "types": Counter()})
            edge["weight"] += EDGE_WEIGHTS[kind]
            edge["count"] += 1
            edge["types"][kind] += 1
            type_counts[kind] += 1

    out_edges: dict[str, dict[str, float]] = defaultdict(dict)
    undirected: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    neighbors: dict[str, set[str]] = defaultdict(set)
    for (source, target), edge in edges.items():
        out_edges[source][target] = edge["weight"]
        undirected[source][target] += edge["weight"]
        undirected[target][source] += edge["weight"]
        neighbors[source].add(target)
        neighbors[target].add(source)

    graph_nodes = sorted(neighbors)
    node_count = len(graph_nodes)
    authors = [key for key, value in accounts.items() if value["posts"]]
    isolated_authors = [key for key in authors if key not in neighbors]

    ranks = pagerank(out_edges, graph_nodes)
    between = betweenness(neighbors)
    community = louvain({node: dict(undirected[node]) for node in graph_nodes})
    components = _components(neighbors)
    in_degree = Counter(target for _, target in edges)
    out_degree = Counter(source for source, _ in edges)
    weighted_in: Counter[str] = Counter()
    weighted_out: Counter[str] = Counter()
    for (source, target), edge in edges.items():
        weighted_in[target] += edge["count"]
        weighted_out[source] += edge["count"]

    community_sizes = Counter(community.values())
    max_rank = max(ranks.values(), default=0) or 1
    ranked = sorted(graph_nodes, key=lambda key: (-ranks[key], -in_degree[key], key))
    # Top 10% of accounts, capped so large graphs still highlight a short list.
    influencers = {key for key in ranked[:min(20, max(1, math.ceil(node_count * 0.1)))] if in_degree[key] >= 2}
    bridge_candidates = sorted(
        (key for key in graph_nodes
         if between[key] > 0 and any(community[neighbor] != community[key] for neighbor in neighbors[key])),
        key=lambda key: (-between[key], key),
    )
    bridges = set(bridge_candidates[:min(15, max(1, math.ceil(node_count * 0.05)))])

    def classify(key: str) -> str:
        data = accounts[key]
        if key in influencers:
            return "influencer"
        if key in bridges:
            return "bridge"
        if data["posts"] and data["received"]["reply"] + data["received"]["quote"] >= 2:
            return "conversation_driver"
        if out_degree[key] >= 2 and in_degree[key] * 3 <= out_degree[key]:
            return "amplifier"
        if not data["posts"]:
            return "referenced"
        return "participant"

    roles = {key: classify(key) for key in graph_nodes}

    def node_payload(key: str) -> dict[str, Any]:
        data = accounts[key]
        location = data["location"]
        return {
            "id": key,
            "username": data["username"],
            "name": data["name"],
            "avatar": data["avatar"],
            "followers": data["followers"],
            "verified": data["verified"],
            "posts": data["posts"],
            "engagement": data["engagement"],
            "in_degree": in_degree[key],
            "out_degree": out_degree[key],
            "interactions_received": weighted_in[key],
            "interactions_sent": weighted_out[key],
            "received": {kind: data["received"][kind] for kind in EDGE_TYPES},
            "pagerank": round(ranks.get(key, 0), 6),
            "influence": round(100 * ranks.get(key, 0) / max_rank, 1),
            "betweenness": round(between.get(key, 0), 6),
            "community": community.get(key),
            "role": roles[key],
            "location": location.label if location else None,
            "province_code": location.province_code if location else None,
        }

    actors = [node_payload(key) for key in ranked[:25]]
    brokers = [node_payload(key) for key in sorted(
        (key for key in graph_nodes if between[key] > 0), key=lambda key: (-between[key], key))[:8]]
    role_counts = Counter(roles.values())

    communities = []
    for group, size in sorted(community_sizes.items(), key=lambda item: (-item[1], item[0])):
        if size < 2 or len(communities) >= 8:
            continue
        group_members = [key for key in ranked if community[key] == group]
        internal = sum(edge["count"] for (source, target), edge in edges.items()
                       if community[source] == group and community[target] == group)
        tags: Counter[str] = Counter()
        sentiment: Counter[str] = Counter()
        regions: Counter[str] = Counter()
        for key in group_members:
            tags.update(hashtags_by_author[key])
            sentiment.update(sentiment_by_author[key])
            location = accounts[key]["location"]
            if location and location.province:
                regions[location.province] += 1
        top_members = group_members[:5]
        communities.append({
            "id": group,
            "label": f"@{accounts[top_members[0]]['username']}",
            "size": size,
            "share": round(size / node_count, 4) if node_count else 0,
            "internal_interactions": internal,
            "authors": sum(1 for key in group_members if accounts[key]["posts"]),
            "top_members": [{"username": accounts[key]["username"], "name": accounts[key]["name"],
                             "influence": round(100 * ranks[key] / max_rank, 1)} for key in top_members],
            "top_hashtags": [tag for tag, _ in tags.most_common(4)],
            "sentiment": {label: sentiment[label] for label in ("positive", "neutral", "negative")},
            "top_region": regions.most_common(1)[0][0] if regions else None,
        })

    # Show whole connected clusters, largest first, so the drawing keeps its structure.
    component_of = {node: index for index, component in enumerate(components) for node in component}
    graph_keys = sorted(graph_nodes, key=lambda key: (component_of[key], -ranks[key], key))[:GRAPH_NODE_LIMIT]
    included = set(graph_keys)
    pair_weights: dict[tuple[str, str], dict[str, Any]] = {}
    for (source, target), edge in edges.items():
        if source in included and target in included:
            pair = tuple(sorted((source, target)))
            merged = pair_weights.setdefault(pair, {"weight": 0.0, "count": 0, "types": Counter()})
            merged["weight"] += edge["weight"]
            merged["count"] += edge["count"]
            merged["types"].update(edge["types"])
    layout = _layout(graph_keys, [(left, right, value["weight"]) for (left, right), value in pair_weights.items()],
                     community)
    graph_payload = {
        "nodes": [{**node_payload(key), "x": layout[key][0], "y": layout[key][1]} for key in graph_keys],
        "edges": [
            {"source": left, "target": right, "weight": round(value["weight"], 2), "count": value["count"],
             "type": value["types"].most_common(1)[0][0]}
            for (left, right), value in sorted(pair_weights.items(), key=lambda item: -item[1]["weight"])
        ],
        "truncated": node_count > len(graph_keys),
    }

    strongest = sorted(edges.items(), key=lambda item: (-item[1]["count"], item[0]))[:10]
    undirected_edges = sum(len(adjacent) for adjacent in neighbors.values()) // 2
    max_degree = max((len(adjacent) for adjacent in neighbors.values()), default=0)
    reciprocal = sum(1 for source, target in edges if (target, source) in edges)
    centralization = (
        sum(max_degree - len(neighbors[node]) for node in graph_nodes) / ((node_count - 1) * (node_count - 2))
        if node_count > 2 else 0.0
    )

    return {
        "stats": {
            "nodes": node_count,
            "edges": len(edges),
            "interactions": sum(type_counts.values()),
            "authors": len(authors),
            "isolated_authors": len(isolated_authors),
            "referenced_accounts": sum(1 for key in graph_nodes if not accounts[key]["posts"]),
            "density": round(len(edges) / (node_count * (node_count - 1)), 5) if node_count > 1 else 0,
            "reciprocity": round(reciprocal / len(edges), 4) if edges else 0,
            "average_degree": round(2 * undirected_edges / node_count, 2) if node_count else 0,
            "clustering": round(_clustering(neighbors), 4),
            "components": len(components),
            "largest_component_share": round(len(components[0]) / node_count, 4) if components else 0,
            "communities": sum(1 for size in community_sizes.values() if size >= 2),
            "modularity": round(modularity({node: dict(undirected[node]) for node in graph_nodes}, community), 4),
            "centralization": round(centralization, 4),
            "interaction_types": {kind: type_counts[kind] for kind in EDGE_TYPES},
            "roles": dict(role_counts),
            "betweenness_sampled": node_count > BETWEENNESS_EXACT_LIMIT,
        },
        "actors": actors,
        "brokers": brokers,
        "communities": communities,
        "strongest_ties": [
            {"source": accounts[source]["username"], "target": accounts[target]["username"],
             "count": edge["count"], "types": dict(edge["types"])}
            for (source, target), edge in strongest
        ],
        "hashtag_pairs": [{"tags": list(pair), "count": count} for pair, count in hashtag_pairs.most_common(10)
                          if count >= 2],
        "graph": graph_payload,
    }
