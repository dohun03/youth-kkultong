#!/usr/bin/env python3
"""공식 원본 2개를 검증해 지역 시드 스냅샷을 재생성한다. 네트워크·환경변수는 사용하지 않는다."""
import argparse
import csv
import hashlib
import io
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

FILES = {
    'code-full-download.bin': '44a3fe4cacf88ce98e35fb883807d2725b589f427ff4d73ee40b914d1286bacd',
    'jscode20260701-including-retired.zip': '47c0bbe730748b6e56574aaa97aa43d3393b3a4218b9ec2de62efd2ce0696bee',
}
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def read_reference(archive_bytes):
    """공식 XLSX의 시도·시군구명과 생성/말소일을 읽는다."""
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        member = next(n for n in archive.namelist() if '/KIKcd_B.' in n and n.endswith('.xlsx'))
        with zipfile.ZipFile(io.BytesIO(archive.read(member))) as book:
            strings = []
            if 'xl/sharedStrings.xml' in book.namelist():
                strings = [''.join(node.itertext()) for node in ET.fromstring(book.read('xl/sharedStrings.xml')).findall('s:si', NS)]
            records = {}
            with book.open('xl/worksheets/sheet1.xml') as stream:
                for _, row in ET.iterparse(stream, events=['end']):
                    if row.tag != f'{{{NS["s"]}}}row':
                        continue
                    cells = {}
                    for cell in row.findall('s:c', NS):
                        value = cell.findtext('s:v', namespaces=NS)
                        if cell.get('t') == 's' and value is not None:
                            value = strings[int(value)]
                        elif cell.get('t') == 'inlineStr':
                            value = ''.join(cell.find('s:is', NS).itertext())
                        if value is not None:
                            cells[re.sub(r'\d+', '', cell.get('r'))] = value.strip()
                    code = cells.get('A', '')
                    if re.fullmatch(r'\d{10}', code) and code.endswith('00000'):
                        if code in records:
                            raise ValueError(f'행정안전부 원본의 중복 코드: {code}')
                        for key in ('F', 'G'):
                            if cells.get(key):
                                datetime.strptime(cells[key], '%Y%m%d')
                        records[code] = cells
                    row.clear()
            return records, member


def prepare(source_dir):
    originals = {name: (source_dir / name).read_bytes() for name in FILES}
    for name, content in originals.items():
        if hashlib.sha256(content).hexdigest() != FILES[name]:
            raise ValueError(f'공식 원본 해시 불일치: {name}')
    with zipfile.ZipFile(io.BytesIO(originals['code-full-download.bin'])) as archive:
        text = archive.read('법정동코드 전체자료.txt').decode('cp949')
    all_rows = list(csv.DictReader(io.StringIO(text), delimiter='\t'))
    if len(all_rows) != len({r['법정동코드'] for r in all_rows}) or len(all_rows) != 53403:
        raise ValueError('공식 전체자료 건수·코드 중복 오류')
    selected = [r for r in all_rows if r['법정동코드'].endswith('00000')]
    selected_codes = {r['법정동코드'] for r in selected}
    reference, member = read_reference(originals['jscode20260701-including-retired.zip'])
    by_name = defaultdict(list)
    for row in selected:
        by_name[row['법정동명'].strip()].append(row)
    regions, name_differences = [], []
    for row in sorted(selected, key=lambda r: r['법정동코드']):
        legal_code = row['법정동코드']
        details = reference[legal_code]
        name = row['법정동명'].strip()
        reference_name = ' '.join(details[k] for k in ('B', 'C') if details.get(k))
        if name != reference_name:
            name_differences.append({'code': legal_code[:5], 'primaryName': name, 'referenceName': reference_name})
        if (row['폐지여부'] == '폐지') != bool(details.get('G')):
            raise ValueError(f'공식 원본의 폐지 상태 불일치: {legal_code}')
        parent_code = None
        if ' ' in name:
            parent_name = name.rsplit(' ', 1)[0]
            # 동명 과거 코드는 자식의 존속 기간을 포함한 공식 생성/말소 기간으로 구분한다.
            candidates = []
            for parent in by_name[parent_name]:
                dates = reference[parent['법정동코드']]
                if dates['F'] <= details['F'] and (not dates.get('G') or (details.get('G') and details['G'] <= dates['G'])):
                    candidates.append(parent)
            if len(candidates) != 1:
                raise ValueError(f'공식 명칭·기간으로 부모를 유일하게 확인할 수 없음: {legal_code}')
            parent_code = candidates[0]['법정동코드'][:5]
        regions.append({'code': legal_code[:5], 'name': name, 'provinceName': details['B'],
                        'parentCode': parent_code, 'isActive': row['폐지여부'] == '존재'})
    expected_difference = [{'code': '47012', 'primaryName': '경상북도 대구시 중구', 'referenceName': '경상북도 대구시 동구'}]
    if name_differences != expected_difference:
        raise ValueError('검토되지 않은 원본 명칭 차이')
    if len(regions) != 537 or sum(r['isActive'] for r in regions) != 284:
        raise ValueError('시드 범위·현행 코드 건수 오류')
    return {'source': {
        'effectiveDate': '2026-07-01', 'verifiedOn': '2026-10-17',
        'primaryUrl': 'https://www.code.go.kr/stdcode/regCodeL.do?menuNo=101010100010',
        'primaryDownload': {'url': 'https://www.code.go.kr/etc/codeFullDown.do', 'method': 'POST', 'form': {'codeseId': '법정동코드'}},
        'referenceUrl': 'https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=127039',
        'referenceDownloadUrl': 'https://www.mois.go.kr/cmm/fms/FileDown.do?atchFileId=FILE_00146280tlU2Y2B&fileSn=1',
        'referenceMember': member, 'originalSha256': FILES,
        'scope': '공식 전체자료의 10자리 법정동코드 중 하위 5자리가 00000인 시도·시군구·상위 시를 현행/폐지 모두 포함',
        'parentRule': '공식 전체 명칭의 직접 상위 명칭을 정확히 조회하고 행정안전부 생성/말소 기간이 자식 존속 기간을 포함하는 단일 코드를 선택. 코드 앞자리로 추정하지 않음',
        'parentFieldNote': 'code.go의 상위지역코드는 일반구를 시도에 연결하기도 하므로 상위 시 관계를 표현할 때 그대로 복사하지 않음. 공식 시군구명과 기간으로 직접 상위 시를 확인',
        'referenceOnlyCodes': sorted(code[:5] for code in reference if code not in selected_codes),
        'nameDifferences': name_differences,
        'nameDecision': '47012는 2026-10-17 공식 개별 조회와 전체자료가 일치하는 primaryName을 사용. 7월 자료는 시도·기간 대조에 사용',
        'counts': {'total': 537, 'active': 284, 'retired': 253},
        'regionsSha256': hashlib.sha256(json.dumps(regions, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest(),
    }, 'regions': regions}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=Path('docs/api-research/official/research-2'))
    parser.add_argument('--output', type=Path, default=Path(__file__).with_name('regions.json'))
    args = parser.parse_args()
    snapshot = prepare(args.source_dir)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(f'공식 지역 스냅샷 생성: {snapshot["source"]["counts"]}')
