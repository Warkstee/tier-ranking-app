image := "tier-ranking-app"
port := "4173"

default:
    @just --list

build:
    docker build -t {{image}} .

run: build
    docker run --rm -p {{port}}:80 {{image}}

run-config: build
    docker run --rm -p {{port}}:80 -v "$PWD/tier-ranking.json:/usr/share/nginx/html/tier-ranking.json:ro" {{image}}

compose:
    docker compose up -d
