"""Small CSV / OOXML adapter. No macros, formulas, links or code are evaluated."""

import csv
import io
import posixpath
from typing import Any
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape
from zipfile import ZipFile

MAX_BYTES = 2_000_000
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def read_sheets(content: bytes, filename: str) -> dict[str, list[list[str]]]:
    if len(content) > MAX_BYTES:
        raise ValueError("Choose a file smaller than 2 MB.")
    if filename.lower().endswith(".csv"):
        return {"Options": list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))}
    if not filename.lower().endswith(".xlsx"):
        raise ValueError("Choose an XLSX or CSV file.")
    with ZipFile(io.BytesIO(content)) as archive:
        if sum(entry.file_size for entry in archive.infolist()) > 15_000_000:
            raise ValueError("The workbook is too large after extraction.")

        def xml(path: Any) -> Any:
            data = archive.read(path).decode("utf-8-sig")
            if "<!DOCTYPE" in data.upper() or "<!ENTITY" in data.upper():
                raise ValueError("Workbook entities are not supported.")
            return ET.fromstring(data)  # noqa: S314 -- DOCTYPE/entities refused above; ZIP size bounded

        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = [
                "".join(n.itertext()) for n in xml("xl/sharedStrings.xml").findall("s:si", NS)
            ]
        relations = {r.attrib["Id"]: r.attrib["Target"] for r in xml("xl/_rels/workbook.xml.rels")}
        result = {}
        for sheet in xml("xl/workbook.xml").findall("s:sheets/s:sheet", NS):
            ref = sheet.attrib[
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            ]
            path = posixpath.normpath(posixpath.join("xl", relations[ref]))
            if relations[ref].startswith("/"):
                path = relations[ref].lstrip("/")
            if not path.startswith("xl/"):
                raise ValueError("Invalid workbook path.")
            rows = []
            for row in xml(path).findall("s:sheetData/s:row", NS):
                cells: list[str] = []
                for cell in row.findall("s:c", NS):
                    letters = "".join(c for c in cell.attrib.get("r", "A1") if c.isalpha())
                    index = 0
                    for letter in letters:
                        index = index * 26 + ord(letter.upper()) - 64
                    while len(cells) < index:
                        cells.append("")
                    value = cell.findtext("s:v", "", NS)
                    if cell.attrib.get("t") == "s":
                        value = shared[int(value)]
                    elif cell.attrib.get("t") == "inlineStr":
                        value = "".join(cell.find("s:is", NS).itertext())
                    cells[index - 1] = value
                rows.append(cells)
            result[sheet.attrib["name"]] = rows
        return result


def write_table(rows: list[list[str]], format: str) -> bytes:
    if format == "csv":
        output = io.StringIO()
        # Prevent spreadsheet formula injection when exports are opened in Excel.
        csv.writer(output).writerows(
            [["'" + c if c.startswith(("=", "+", "-", "@")) else c for c in row] for row in rows]
        )
        return output.getvalue().encode("utf-8-sig")
    binary_output = io.BytesIO()
    with ZipFile(binary_output, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            (
                '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/packag'
                'e/2006/content-types"><Default Extension="rels" ContentType="application/vn'
                'd.openxmlformats-package.relationships+xml"/><Default Extension="xml" Conte'
                'ntType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType'
                '="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xm'
                'l"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application'
                '/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
            ),
        )
        archive.writestr(
            "_rels/.rels",
            (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relati'
                'onships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/of'
                'ficeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><'
                "/Relationships>"
            ),
        )
        archive.writestr(
            "xl/workbook.xml",
            (
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
                ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationshi'
                'ps"><sheets><sheet name="Options" sheetId="1" r:id="rId1"/></sheets></workb'
                "ook>"
            ),
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relati'
                'onships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/of'
                'ficeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
                "</Relationships>"
            ),
        )
        body = []
        for number, row in enumerate(rows, 1):
            cells = "".join(
                f'<c r="{chr(65 + i)}{number}" t="inlineStr"><is>'
                f'<t xml:space="preserve">{escape(value)}</t></is></c>'
                for i, value in enumerate(row)
            )
            body.append(f'<row r="{number}">{cells}</row>')
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
            + "".join(body)
            + "</sheetData></worksheet>",
        )
    return binary_output.getvalue()
