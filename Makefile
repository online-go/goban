all dev: 
	yarn run dev

build:
	yarn run build

lint:
	yarn run lint

clean:
	rm -Rf lib

publish:
	make build
	yarn publish ./
