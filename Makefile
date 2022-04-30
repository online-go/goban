VERSION=$(shell node -pe 'JSON.parse(require("fs").readFileSync("package.json")).version')

all dev: 
	yarn run dev

lint:
	yarn run lint

doc typedoc:
	yarn run typedoc

clean:
	rm -Rf lib node

publish push: publish_npm upload_to_cdn notify


notify:
	MSG=`git log -1 --pretty="%an - %B" | sed s/\"//g | sed s/\'//g `; \
	VERSION=`git describe --long`; \
	curl -X POST -H 'Content-type: application/json' --data '{"text":"'"[GOBAN] $$VERSION $$MSG"'"}' https://hooks.slack.com/services/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

publish_npm: 
	yarn run build-debug
	yarn run build-production
	yarn publish ./

upload_to_cdn:
	rm -Rf deployment-staging-area;
	mkdir deployment-staging-area;
	cp lib/goban.js* deployment-staging-area
	cp lib/goban.min.js* deployment-staging-area
	cp lib/engine.js* deployment-staging-area
	cp lib/engine.min.js* deployment-staging-area
	gsutil -m rsync -r deployment-staging-area/ gs://ogs-site-files/goban/`node -pe 'JSON.parse(require("fs").readFileSync("package.json")).version'`/

.PHONY: doc
