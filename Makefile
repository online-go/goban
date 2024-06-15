VERSION=$(shell node -pe 'JSON.parse(require("fs").readFileSync("package.json")).version')
SLACK_WEBHOOK=$(shell cat ../ogs/.slack-webhook)

all dev: 
	yarn run dev
	
build: lib types
	
lib: build-debug build-production 
	
build-debug:
	yarn run build-debug

build-production:
	yarn run build-production

types:
	yarn run dts


lint:
	yarn run lint

test:
	yarn run test

doc docs typedoc:
	yarn run typedoc

clean:
	rm -Rf lib node

publish push: publish_npm upload_to_cdn notify

beta: beta_npm upload_to_cdn

beta_npm: build
	yarn publish --tag beta ./

notify:
	MSG=`git log -1 --pretty="%B" | sed s/\"//g | sed s/\'//g `; \
	VERSION=`git describe --long`; \
	curl -X POST -H 'Content-type: application/json' --data '{"text":"'"[GOBAN] $$VERSION $$MSG"'"}' $(SLACK_WEBHOOK)

publish_npm: build
	yarn publish ./

upload_to_cdn:
	rm -Rf deployment-staging-area;
	mkdir deployment-staging-area;
	cp lib/goban.js* deployment-staging-area
	cp lib/goban.min.js* deployment-staging-area
	cp lib/engine.js* deployment-staging-area
	cp lib/engine.min.js* deployment-staging-area
	gsutil -m rsync -r deployment-staging-area/ gs://ogs-site-files/goban/`node -pe 'JSON.parse(require("fs").readFileSync("package.json")).version'`/

.PHONY: doc build docs test clean all dev typedoc publich push lib types
