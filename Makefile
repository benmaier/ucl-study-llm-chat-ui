# ucl-chat-widget release automation
#
# Usage:
#   make release VERSION=0.3.1
#   make release-sdk VERSION=1.0.9
#   make release-both WIDGET_VERSION=0.3.1 SDK_VERSION=1.0.9

WIDGET_PKG = packages/widget/package.json
DEMO_PKG = demo/package.json
SDK_DIR = ../ucl-study-llm-chat-api
SDK_PKG = $(SDK_DIR)/package.json

.PHONY: build test release release-sdk release-both tarball help

help:
	@echo "Usage:"
	@echo "  make release VERSION=X.Y.Z          — bump widget, build, tag, create tarball, push"
	@echo "  make release-sdk VERSION=X.Y.Z      — bump SDK, build, push"
	@echo "  make release-both WIDGET_VERSION=X.Y.Z SDK_VERSION=X.Y.Z"
	@echo "  make build                           — build widget"
	@echo "  make test                            — run unit tests"
	@echo "  make tarball                         — create installable tarball from packages/widget"

build:
	npm run build

test:
	npm test

# Create an installable tarball of the widget package
tarball: build
	cd packages/widget && npm pack --pack-destination ../../
	@echo ""
	@echo "Tarball created. Install with:"
	@echo "  npm install ./ucl-chat-widget-$$(node -p "require('./$(WIDGET_PKG)').version").tgz"

# Release the widget: bump version, build, test, tag, create tarball, push
release:
ifndef VERSION
	$(error VERSION is required. Usage: make release VERSION=0.3.1)
endif
	@echo "=== Releasing widget v$(VERSION) ==="
	# Bump version
	node -e "const p=require('./$(WIDGET_PKG)'); p.version='$(VERSION)'; require('fs').writeFileSync('$(WIDGET_PKG)', JSON.stringify(p, null, 2)+'\n')"
	sed -i '' 's/"ucl-chat-widget": "[^"]*"/"ucl-chat-widget": "^$(VERSION)"/' $(DEMO_PKG)
	# Build and test
	npm run build
	npm test
	# Create tarball
	cd packages/widget && npm pack --pack-destination ../../
	# Commit, tag, push
	git add $(WIDGET_PKG) $(DEMO_PKG)
	git commit -m "chore: bump to $(VERSION)"
	git tag -a v$(VERSION) -m "v$(VERSION)"
	git push && git push --tags
	@echo ""
	@echo "=== Released widget v$(VERSION) ==="
	@echo "Tarball: ucl-chat-widget-$(VERSION).tgz"
	@echo "Install: npm install github:benmaier/ucl-study-llm-chat-ui#semver:v$(VERSION)"
	@echo "Or:      npm install ./ucl-chat-widget-$(VERSION).tgz"

# Release the SDK: bump version, build, push
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

# Release both: SDK first, then widget
release-both:
ifndef WIDGET_VERSION
	$(error WIDGET_VERSION is required)
endif
ifndef SDK_VERSION
	$(error SDK_VERSION is required)
endif
	$(MAKE) release-sdk VERSION=$(SDK_VERSION)
	$(MAKE) release VERSION=$(WIDGET_VERSION)
