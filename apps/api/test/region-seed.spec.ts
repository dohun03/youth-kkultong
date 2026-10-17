import { createHash } from 'node:crypto';
import { validateRegions } from '../src/database/seeds/regions.seed';
import snapshot from '../src/database/seeds/regions.json';

const root = { code: '00001', name: '검증도', provinceName: '검증도', parentCode: null, isActive: true };
const child = { code: '00002', name: '검증도 검증시', provinceName: '검증도', parentCode: '00001', isActive: true };

describe('공식 지역 시드 자료 검증', () => {
  it('원본에서 재현한 537개 코드와 명시된 스냅샷 해시·현행 건수가 일치한다', () => {
    const rows = validateRegions(snapshot.regions);
    expect(rows).toHaveLength(537);
    expect(rows.filter(row => row.isActive)).toHaveLength(284);
    expect(rows.filter(row => !row.isActive)).toHaveLength(253);
    expect(createHash('sha256').update(JSON.stringify(snapshot.regions)).digest('hex'))
      .toBe(snapshot.source.regionsSha256);
    expect(snapshot.source.effectiveDate).toBe('2026-07-01');
  });

  it('공식 명칭·기간으로 확인한 상위 시와 과거 이름·코드를 유지한다', () => {
    const byCode = new Map(validateRegions(snapshot.regions).map(row => [row.code, row]));
    expect(byCode.get('41111')).toMatchObject({ name: '경기도 수원시 장안구', parentCode: '41110', isActive: true });
    expect(byCode.get('48121')).toMatchObject({ parentCode: '48120', isActive: true });
    expect(byCode.get('48151')).toMatchObject({ parentCode: '48150', isActive: false });
    expect(byCode.get('28110')).toMatchObject({ name: '인천광역시 중구', isActive: false });
    expect(byCode.get('36110')).toMatchObject({ name: '세종특별자치시', parentCode: null, provinceName: '세종특별자치시' });
    expect(byCode.has('36000')).toBe(false);
    expect(byCode.get('12000')).toMatchObject({ name: '전남광주통합특별시', isActive: true });
    expect(byCode.get('29000')?.isActive).toBe(false);
    expect(byCode.get('46000')?.isActive).toBe(false);
    expect(byCode.get('41192')?.name).toBe(byCode.get('41195')?.name);
    expect(byCode.get('41192')?.isActive).toBe(true);
    expect(byCode.get('41195')?.isActive).toBe(false);
  });

  it('역사 명칭이 같아도 코드가 다르면 별개로 보존한다', () => {
    expect(validateRegions([root, { ...root, code: '00003', isActive: false }])).toHaveLength(2);
  });

  it('자료 순서가 자식부터여도 명시된 부모 코드로 검증한다', () => {
    expect(validateRegions([child, root])).toEqual([child, root]);
  });

  it.each([
    ['빈 자료', []],
    ['코드 형식', [{ ...root, code: '1234' }]],
    ['빈 이름', [{ ...root, name: ' ' }]],
    ['이름 길이', [{ ...root, name: '가'.repeat(101) }]],
    ['빈 시도명', [{ ...root, provinceName: '' }]],
    ['현행 여부 타입', [{ ...root, isActive: 'true' }]],
    ['중복 코드', [root, root]],
    ['현행 이름 중복', [root, { ...root, code: '00003' }]],
    ['상위 코드 없음', [child]],
    ['자기 참조', [root, { ...child, parentCode: child.code }]],
    ['중간 상위 누락', [root, { ...child, name: '검증도 다른시 검증구' }]],
    ['시도 불일치', [root, { ...child, provinceName: '다른도' }]],
    ['상위 관계 누락', [root, { ...child, parentCode: null }]],
  ])('%s 오류를 DB 저장 전에 거부한다', (_name, input) => {
    expect(() => validateRegions(input)).toThrow();
  });
});
