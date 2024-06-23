
all:
	@echo "Engine artifacts are built using the root Makefile."
	@echo "To publish use make [publish|publish-beta]"

publish-beta:
	yarn publish --no-git-tag-version --tag beta ./

publish:
	yarn publish --no-git-tag-version ./