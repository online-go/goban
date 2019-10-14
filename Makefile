all dev: 
	yarn run dev

build:
	yarn run build

lint:
	yarn run lint

doc typedoc:
	yarn run typedoc

clean:
	rm -Rf lib

publish:
	make build
	yarn publish ./

.PHONY: doc
