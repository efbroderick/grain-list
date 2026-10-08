PYTHON ?= .venv/bin/python

.PHONY: setup test validate data geocode serve review

setup:
	python3.12 -m venv .venv
	$(PYTHON) -m pip install --upgrade pip
	$(PYTHON) -m pip install -r requirements.txt

test:
	$(PYTHON) -m unittest discover -s tests
	node --check app.js

validate:
	$(PYTHON) tools/validate_grain_list_data.py

data:
	$(PYTHON) tools/maintain_directory.py --input data/publication_list.csv

geocode:
	$(PYTHON) tools/maintain_directory.py --input data/publication_list.csv --geocode

serve:
	$(PYTHON) -m http.server 4173

review:
	$(PYTHON) tools/maintain_directory.py --input "$(INPUT)"
