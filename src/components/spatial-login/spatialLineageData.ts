export interface LineageNode {
  id: string;
  name: string;
  fullName: string;
  relation: string;
  atomicNo: string;
  mass: string;
  type: 'primary' | 'relative';
  x: number;
  y: number;
  z: number;
}

export interface LineageLink {
  source: string;
  target: string;
  type: 'marriage' | 'descent';
}

export const lineageData: LineageNode[] = [
  { id: 'h', name: 'DK', fullName: 'Hydrogen', relation: 'Nonmetal', atomicNo: '1', mass: '1.008', type: 'primary', x: 0, y: 0, z: 40 },
  { id: 'he', name: 'He', fullName: 'Helium', relation: 'Noble Gas', atomicNo: '2', mass: '4.003', type: 'relative', x: 140, y: 0, z: 40 },
  { id: 'li', name: 'Li', fullName: 'Lithium', relation: 'Alkali Metal', atomicNo: '3', mass: '6.94', type: 'relative', x: -60, y: -160, z: 0 },
  { id: 'be', name: 'Be', fullName: 'Beryllium', relation: 'Alkaline Earth', atomicNo: '4', mass: '9.012', type: 'relative', x: 60, y: -160, z: 0 },
  { id: 'b', name: 'B', fullName: 'Boron', relation: 'Metalloid', atomicNo: '5', mass: '10.81', type: 'relative', x: 200, y: -160, z: 0 },
  { id: 'c', name: 'C', fullName: 'Carbon', relation: 'Nonmetal', atomicNo: '6', mass: '12.01', type: 'relative', x: 320, y: -160, z: 0 },
  { id: 'n', name: 'N', fullName: 'Nitrogen', relation: 'Nonmetal', atomicNo: '7', mass: '14.01', type: 'relative', x: 20, y: 160, z: 60 },
  { id: 'o', name: 'O', fullName: 'Oxygen', relation: 'Nonmetal', atomicNo: '8', mass: '16.00', type: 'relative', x: 120, y: 160, z: 60 },
  { id: 'f', name: 'F', fullName: 'Fluorine', relation: 'Halogen', atomicNo: '9', mass: '19.00', type: 'relative', x: -160, y: 20, z: 20 },
  { id: 'ne', name: 'Ne', fullName: 'Neon', relation: 'Noble Gas', atomicNo: '10', mass: '20.18', type: 'relative', x: -100, y: -300, z: -40 },
  { id: 'na', name: 'Na', fullName: 'Sodium', relation: 'Alkali Metal', atomicNo: '11', mass: '22.99', type: 'relative', x: -20, y: -300, z: -40 },
  { id: 'mg', name: 'Mg', fullName: 'Magnesium', relation: 'Alkaline Earth', atomicNo: '12', mass: '24.31', type: 'relative', x: -220, y: -140, z: -10 },
  /** 타일 표기: Cf · Coffee (원소 정보는 Cf 캘리포늄 기준) */
  { id: 'al', name: 'Cf', fullName: 'Coffee', relation: 'Happiness', atomicNo: '98', mass: '251', type: 'relative', x: -280, y: 0, z: 0 },
];

export const lineageLinks: LineageLink[] = [
  { source: 'h', target: 'he', type: 'marriage' },
  { source: 'li', target: 'be', type: 'marriage' },
  { source: 'b', target: 'c', type: 'marriage' },
  { source: 'ne', target: 'na', type: 'marriage' },
  { source: 'li', target: 'h', type: 'descent' },
  { source: 'be', target: 'h', type: 'descent' },
  { source: 'li', target: 'f', type: 'descent' },
  { source: 'be', target: 'f', type: 'descent' },
  { source: 'b', target: 'he', type: 'descent' },
  { source: 'c', target: 'he', type: 'descent' },
  { source: 'h', target: 'n', type: 'descent' },
  { source: 'he', target: 'n', type: 'descent' },
  { source: 'h', target: 'o', type: 'descent' },
  { source: 'he', target: 'o', type: 'descent' },
  { source: 'ne', target: 'li', type: 'descent' },
  { source: 'na', target: 'li', type: 'descent' },
  { source: 'ne', target: 'mg', type: 'descent' },
  { source: 'na', target: 'mg', type: 'descent' },
  { source: 'mg', target: 'al', type: 'descent' },
];
