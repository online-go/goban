VERSION=$(shell node -pe 'JSON.parse(require("fs").readFileSync("package.json")).version')
GIT_VERSION=$(shell git describe --long | sed 's/\-g.*//' | sed 's/\-/\./')
SLACK_WEBHOOK=$(shell cat ../ogs/.slack-webhook)

all dev: 
	yarn run dev
	
build: build-debug build-production
	cp src/Goban.styl build/Goban.styl
	
build-debug:
	yarn run build-debug

build-production:
	yarn run build-production


lint:
	yarn run lint

test:
	yarn run test
	
detect-duplicate-code duplicate-code-detection:
	yarn run detect-duplicate-code

doc docs typedoc:
	yarn run typedoc

publish_docs: typedoc
	cd docs && git add docs && git commit -m "Update docs" && git push

clean:
	rm -Rf lib node build engine/build

publish push: publish-production publish_docs upload_to_cdn notify restore-dev-versions

beta: beta_npm upload_to_cdn

beta_npm: build publish-beta

pack: build
	yarn pack

restore-dev-versions:
	sed -i'.tmp' "s/\"version\": .*/\"version\": \"dev\",/" package.json
	sed -i'.tmp' "s/\"version\": .*/\"version\": \"dev\",/" engine/package.json

set-beta-versions:
	sed -i'.tmp' "s/\"version\": .*/\"version\": \"$(GIT_VERSION)-beta\",/" package.json
	sed -i'.tmp' "s/\"version\": .*/\"version\": \"$(GIT_VERSION)-beta\",/" engine/package.json

set-versions:
	sed -i'.tmp' "s/\"version\": .*/\"version\": \"$(GIT_VERSION)\",/" package.json
	sed -i'.tmp' "s/\"version\": .*/\"version\": \"$(GIT_VERSION)\",/" engine/package.json


publish-beta: build set-beta-versions
	@read -p "Publishing version $(GIT_VERSION) to the beta tag. Enter OTP : " otp; \
	npm publish --tag beta --otp $$otp engine/ && \
	npm publish --tag beta --otp $$otp ./ && \
	echo "" && \
	echo "" && \
	echo "Published version $(GIT_VERSION)-beta to the beta tag successfully." && \
	echo ""
	@make restore-dev-versions

publish-production: build set-versions
	@read -p "Publishing version $(GIT_VERSION). Enter OTP : " otp; \
	npm publish --otp $$otp engine/ && \
	npm publish --otp $$otp ./ && \
	echo "" && \
	echo "" && \
	echo "Published version $(GIT_VERSION) successfully." && \
	echo ""
	@make restore-dev-versions

notify:
	MSG=`git log -1 --pretty="%B" | sed s/\"//g | sed s/\'//g `; \
	VERSION=`git describe --long`; \
	curl -X POST -H 'Content-type: application/json' --data '{"text":"'"[GOBAN] $$VERSION $$MSG"'"}' $(SLACK_WEBHOOK)


upload_to_cdn: set-versions
	rm -Rf deployment-staging-area;
	mkdir deployment-staging-area;
	cp build/goban.js* deployment-staging-area
	cp build/goban.min.js* deployment-staging-area
	gsutil -m rsync -r deployment-staging-area/ gs://ogs-site-files/goban/`node -pe 'JSON.parse(require("fs").readFileSync("package.json")).version'`/

.PHONY: doc build docs test clean all dev typedoc publish push build publish-production upload_to_cdn notify beta beta_npm publish-beta publish_docs build-debug build-production detect-duplicate-code duplicate-code-detection lint
 
