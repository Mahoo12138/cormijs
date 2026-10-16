import { useParams } from 'react-router';
export default function Docs() { const params = useParams(); return <><h1>Docs</h1><p data-testid="splat">{params['*']}</p></>; }
