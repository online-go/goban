VERSION=$(shell node -pe 'JSON.parse(require("fs").readFileSync("package.json")).version')
SLACK_WEBHOOK=$(shell cat ../ogs/.slack-webhook)

all dev: 
	yarn run dev
	
build: lib
	
lib: build-debug build-production
	
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

publish push: publish_npm publish_docs upload_to_cdn notify

beta: beta_npm upload_to_cdn

beta_npm: build publish-beta

publish-beta:
	make -C engine/ publish-beta
	yarn publish --tag beta ./

notify:
	MSG=`git log -1 --pretty="%B" | sed s/\"//g | sed s/\'//g `; \
	VERSION=`git describe --long`; \
	curl -X POST -H 'Content-type: application/json' --data '{"text":"'"[GOBAN] $$VERSION $$MSG"'"}' $(SLACK_WEBHOOK)

publish_npm: build
	make -C engine/ publish
	yarn publish ./

upload_to_cdn:
	rm -Rf deployment-staging-area;
	mkdir deployment-staging-area;
	cp lib/goban.js* deployment-staging-area
	cp lib/goban.min.js* deployment-staging-area
	gsutil -m rsync -r deployment-staging-area/ gs://ogs-site-files/goban/`node -pe 'JSON.parse(require("fs").readFileSync("package.json")).version'`/

.PHONY: doc build docs test clean all dev typedoc publish push lib publish_npm upload_to_cdn notify beta beta_npm publish-beta publish_docs build-debug build-production detect-duplicate-code duplicate-code-detection lint
 
