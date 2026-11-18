import { useId } from 'react';
import type { Badge } from './model';

const enamel: Record<Badge, [string, string]> = {
  standard: ['#54695b', '#293f36'],
  sun: ['#aa8142', '#71512e'],
  moon: ['#787388', '#494958'],
  book: ['#637d7c', '#374f52'],
  leaf: ['#768159', '#45573d'],
  shield: ['#75808a', '#43535d'],
};

function Insignia({ badge }: { badge: Badge }) {
  switch (badge) {
    case 'sun':
      return <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none">
        <circle cx="50" cy="36" r="6.5" fill="currentColor" stroke="none" />
        {Array.from({ length: 8 }, (_, i) => <path key={i} d="M50 24v-3" transform={`rotate(${i * 45} 50 36)`} />)}
      </g>;
    case 'moon':
      return <g fill="currentColor">
        <path d="M53 23a14 14 0 1 0 10 19 12 12 0 0 1-10-19Z" />
        <path d="m59 23 1.5 3.7 3.7 1.5-3.7 1.4L59 33l-1.4-3.4-3.5-1.4 3.5-1.5Z" />
      </g>;
    case 'book':
      return <g stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round" strokeLinecap="round" fill="none">
        <path d="M50 46c-3.8-3.3-8.4-4.7-13.6-4.1V26.4c5.3-.4 9.8 1 13.6 4.2 3.8-3.2 8.4-4.6 13.6-4.2v15.5c-5.1-.6-9.7.8-13.6 4.1Zm0 0V30.6" />
        <path d="m40.2 31.6 5.6 1.5m-5.6 3.2 5.6 1.7m8-4.9 5.8-1.6m-5.8 6.5 5.8-1.7" strokeWidth="1.35" />
      </g>;
    case 'leaf':
      return <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M39 44c-4.3-12 4-18.5 22.4-21.4 1.2 17.6-7.2 24.4-18.1 22.2" fill="currentColor" stroke="none" />
        <path d="M39.2 48.2c3.9-7.4 8.8-13.5 15.4-19" />
        <path d="m44.1 40.7 9.2-9.7m-6.4 6.9 5.7-.5" stroke="#516043" strokeWidth="1.6" />
      </g>;
    case 'shield':
      return <g stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" fill="none">
        <path d="M50 23c3.8 3.1 7.5 4.1 11 4.7C60.9 37.7 57.4 43.7 50 49c-7.4-5.3-10.9-11.3-11-21.3 3.5-.6 7.2-1.6 11-4.7Z" />
        <path d="M50 27.5V44c4.6-4.3 7.1-8.8 7.5-13.8-2.4-.5-5-1.5-7.5-2.7Z" fill="currentColor" stroke="none" />
      </g>;
    default:
      return <g stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M42.7 48.5V23m-3.4 25.5h7.2" fill="none" />
        <path d="M44 25c6-3.8 11.2 4.1 18.2.2l-3.7 6.1 2.6 4.3c-7.7 3.4-11.6-4.6-17.1-.6Z" fill="currentColor" stroke="none" />
        <circle cx="42.7" cy="22.7" r="1.7" fill="currentColor" stroke="none" />
      </g>;
  }
}

/** Enamel field, struck metal rim, laurel and ribbon form one family of map pins. */
export function Emblem({ badge, size = 80 }: { badge: Badge; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [light, dark] = enamel[badge];
  const metal = `url(#${id}-metal)`;
  return <svg aria-hidden="true" focusable="false" width={size} height={size * 0.86} viewBox="0 0 100 86" fill="none">
    <defs>
      <linearGradient id={`${id}-metal`} x1="0" y1="0" x2=".65" y2="1" gradientUnits="objectBoundingBox">
        <stop stopColor="#fff1b9" /><stop offset=".34" stopColor="#d7b979" /><stop offset=".65" stopColor="#ad8b4c" /><stop offset="1" stopColor="#705d35" />
      </linearGradient>
      <linearGradient id={`${id}-field`} x1="0" y1="0" x2=".8" y2="1" gradientUnits="objectBoundingBox">
        <stop stopColor={light} /><stop offset="1" stopColor={dark} />
      </linearGradient>
      <g id={`${id}-sprig`}>
        <path d="M45 69C29 66 16 54 14 37" stroke="#77653e" strokeWidth="2" strokeLinecap="round" />
        <g fill={metal} stroke="#78683e" strokeWidth=".75" strokeLinejoin="round">
          <path d="M16.5 46c-5.2-1.6-7.7-5.2-7.9-10.2 5.4 2.1 7.8 5.1 7.9 10.2Z" />
          <path d="M17.6 48.8c-1.3-4.5-.6-8.5 2.4-12 .9 5.4.5 8.5-2.4 12Z" />
          <path d="M22.5 56.2c-6.3.1-10.1-3.2-12.7-8 5.9.9 10 3.3 12.7 8Z" />
          <path d="M23.4 56.8c-1.6-5.3-1-9.6 1.5-13.5 1.7 5.5 1.6 9.5-1.5 13.5Z" />
          <path d="M30.4 63.3c-5.6 1.5-11.2-.4-15.5-4.8 6.7-.7 11.5.7 15.5 4.8Z" />
          <path d="M32 63.9c-4.2-4.5-5.1-8.9-4.1-14 4.7 4.6 6.3 8.8 4.1 14Z" />
          <path d="M39.4 68c-5.8 3.1-11.1 2.7-16.3.2 5.5-2.7 10.7-3 16.3-.2Z" />
        </g>
      </g>
    </defs>
    <path d="m35 58-3.3 18.2 8.4-3.9 6.3 6.5 3-15.6 3.1 15.6 6.5-6.5 8.4 3.9L64.8 58Z" fill={dark} stroke="#77653e" strokeWidth="1.1" />
    <use href={`#${id}-sprig`} /><use href={`#${id}-sprig`} transform="translate(100 0) scale(-1 1)" />
    <path d="m50 5.2 6 7.5 11.9 3.2 8.6 8.4-1.5 23.4-8.4 11.8L50 69.1 33.4 59.5l-8.6-11.8-1.3-23.4 8.6-8.4L44 12.7Z" fill={metal} stroke="#695a38" strokeWidth="1.45" />
    <path d="m50 10 5.7 6.5 10.2 2.6 6.6 6.5-1.3 20.7-7.2 10.2-14 8.3-14-8.3-7.4-10.2-1.1-20.7 6.6-6.5 10.2-2.6Z" fill={`url(#${id}-field)`} stroke="#544e35" strokeWidth="1.25" />
    <path d="m50 14.7 4.2 4.7 10 2.7 4.9 4.8-1.1 18.2-6.3 8.7L50 61l-11.8-7.2-6.3-8.7-1-18.2 4.8-4.8 10-2.7Z" stroke="#f0d69a" strokeOpacity=".64" strokeWidth=".8" />
    <g color="#f7dfa0"><Insignia badge={badge} /></g>
    <path d="m50 53 2 1.8-2 1.8-2-1.8Z" fill="#e4c383" />
    <path d="m45 4.5 5-2 5 2" stroke="#8b794c" strokeWidth=".8" strokeLinecap="round" />
  </svg>;
}
