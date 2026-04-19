# ucl-chat-widget release automation
#
# The widget repo's main branch is PR-protected, so a release is a two-step
# flow:
#
#   1. make release-prepare VERSION=X.Y.Z
#        Bumps versions, builds, tests, creates a tarball, commits on a new
#        release branch, pushes, and opens a PR.
#
#   2. (review + merge the PR on GitHub)
#
#   3. make release-publish VERSION=X.Y.Z
#        Pulls main, tags v$(VERSION), pushes the tag, and creates a GitHub
#        Release with the tarball attached. This is the install artifact
#        that consumers (main-app) should install from — the monorepo root
#        is not installable because of its `file:` SDK dep.
#
# For SDK releases (separate repo, currently not PR-protected):
#   make release-sdk VERSION=1.0.9

WIDGET_PKG = packages/widget/package.json
DEMO_PKG = demo/package.json
SDK_DIR = ../ucl-study-llm-chat-api
SDK_PKG = $(SDK_DIR)/package.json
GH_REPO = benmaier/ucl-study-llm-chat-ui

.PHONY: build test release release-prepare release-publish release-sdk release-both tarball help

help:
	@echo "Widget release (two-step because main is PR-protected):"
	@echo "  make release-prepare VERSION=X.Y.Z    — bump, build, test, tarball, branch, PR"
	@echo "  make release-publish VERSION=X.Y.Z    — tag + GitHub Release (run after PR merge)"
	@echo ""
	@echo "Other targets:"
	@echo "  make release-sdk VERSION=X.Y.Z        — bump SDK, build, push (direct, no PR)"
	@echo "  make release-both WIDGET_VERSION=X.Y.Z SDK_VERSION=X.Y.Z"
	@echo "  make build                            — build widget"
	@echo "  make test                             — run unit tests"
	@echo "  make tarball                          — npm pack the widget into repo root"

build:
	npm run build

test:
	npm test

# Create an installable tarball of the widget package in the repo root.
tarball: build
	cd packages/widget && npm pack --pack-destination ../../
	@echo ""
	@echo "Tarball created. Install locally with:"
	@echo "  npm install ./ucl-chat-widget-$$(node -p "require('./$(WIDGET_PKG)').version").tgz"

# Phase 1: bump versions, build, test, create tarball, push branch, open PR.
release-prepare:
ifndef VERSION
	$(error VERSION is required. Usage: make release-prepare VERSION=0.3.15)
endif
	@echo "=== Preparing release v$(VERSION) ==="
	git fetch origin main
	git checkout -b chore/release-$(VERSION) origin/main
	# Bump versions
	node -e "const p=require('./$(WIDGET_PKG)'); p.version='$(VERSION)'; require('fs').writeFileSync('$(WIDGET_PKG)', JSON.stringify(p, null, 2)+'\n')"
	sed -i '' 's/"ucl-chat-widget": "[^"]*"/"ucl-chat-widget": "^$(VERSION)"/' $(DEMO_PKG)
	# Build + test
	npm run build
	npm test
	# Tarball — useful locally; CI/release step re-packs on merged main
	cd packages/widget && npm pack --pack-destination ../../
	# Commit, push branch, open PR
	git add $(WIDGET_PKG) $(DEMO_PKG)
	git commit -m "chore: bump to $(VERSION)"
	git push -u origin chore/release-$(VERSION)
	gh pr create --title "chore: bump to $(VERSION)" \
		--body "Release bump for widget v$(VERSION). Merge then run \`make release-publish VERSION=$(VERSION)\`."
	@echo ""
	@echo "=== Branch + PR opened for v$(VERSION) ==="
	@echo "Next: merge the PR on GitHub, then run:"
	@echo "  make release-publish VERSION=$(VERSION)"

# Phase 2: tag + create GitHub Release with tarball asset. Run after the
# release-prepare PR is merged.
release-publish:
ifndef VERSION
	$(error VERSION is required. Usage: make release-publish VERSION=0.3.15)
endif
	@echo "=== Publishing v$(VERSION) ==="
	git checkout main
	git pull
	# Sanity: widget package.json version must match VERSION
	@ACTUAL=$$(node -p "require('./$(WIDGET_PKG)').version"); \
		if [ "$$ACTUAL" != "$(VERSION)" ]; then \
			echo "Error: widget/package.json says $$ACTUAL but VERSION=$(VERSION). Did you merge the release-prepare PR?"; \
			exit 1; \
		fi
	# Rebuild from merged main, repack
	npm run build
	cd packages/widget && npm pack --pack-destination ../../
	# Tag + push tag (tags are not PR-gated)
	git tag -a v$(VERSION) -m "v$(VERSION)"
	git push --tags
	# GitHub Release with tarball attached
	gh release create v$(VERSION) ucl-chat-widget-$(VERSION).tgz \
		--title "v$(VERSION)" \
		--notes "Install: \`npm install https://github.com/$(GH_REPO)/releases/download/v$(VERSION)/ucl-chat-widget-$(VERSION).tgz\`"
	@echo ""
	@echo "=== Released widget v$(VERSION) ==="
	@echo "Install: npm install https://github.com/$(GH_REPO)/releases/download/v$(VERSION)/ucl-chat-widget-$(VERSION).tgz"

# Legacy alias: redirect to the two-step flow.
release:
	@echo "The single-step 'release' target no longer works because main is PR-protected."
	@echo "Use the two-step flow instead:"
	@echo "  make release-prepare VERSION=X.Y.Z"
	@echo "  # (merge the PR)"
	@echo "  make release-publish VERSION=X.Y.Z"
	@exit 1

# Release the SDK: bump version, build, push. SDK repo currently allows
# direct pushes to main; if that changes, mirror the widget two-step flow.
release-sdk:
ifndef VERSION
	$(error VERSION is required. Usage: make release-sdk VERSION=1.0.9)
endif
	@echo "=== Releasing SDK v$(VERSION) ==="
	cd $(SDK_DIR) && \
		node -e "const p=require('./package.json'); p.version='$(VERSION)'; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2)+'\n')" && \
		npm run build && \
		git add -A && \
		git commit -m "chore: bump to $(VERSION)" && \
		git push
	@echo "=== Released SDK v$(VERSION) ==="
	@echo "Install: npm install github:benmaier/ucl-study-llm-chat-api"

# Release both: SDK first, then widget (which opens a PR you still need to merge).
release-both:
ifndef WIDGET_VERSION
	$(error WIDGET_VERSION is required)
endif
ifndef SDK_VERSION
	$(error SDK_VERSION is required)
endif
	$(MAKE) release-sdk VERSION=$(SDK_VERSION)
	$(MAKE) release-prepare VERSION=$(WIDGET_VERSION)
	@echo ""
	@echo "After the widget release-prepare PR is merged, run:"
	@echo "  make release-publish VERSION=$(WIDGET_VERSION)"
