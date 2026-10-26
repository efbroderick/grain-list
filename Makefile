PYTHON ?= .venv/bin/python

.PHONY: setup test validate data geocode serve review build

setup:
	python3.12 -m venv .venv
	$(PYTHON) -m pip install --upgrade pip
	$(PYTHON) -m pip install -r requirements.txt

test:
	$(PYTHON) -m unittest discover -s tests
	node --check app.js
	node --check basemap.js
	node --check install.js
	node --check page.js
	node --check submission.js
	node --test tests/*.cjs

validate:
	$(PYTHON) tools/validate_grain_list_data.py

data:
	$(PYTHON) tools/maintain_directory.py --input data/publication_list.csv

geocode:
	$(PYTHON) tools/maintain_directory.py --input data/publication_list.csv --geocode

build:
	node tools/build_site.cjs

serve: build
	$(PYTHON) -m http.server 4173 --directory dist

review:
	$(PYTHON) tools/maintain_directory.py --input "$(INPUT)"
