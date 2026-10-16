import { useParams } from 'react-router';
export default function User() { const { id } = useParams(); return <><h1>User {id}</h1><p>来自 src/pages/users/[id].tsx，位于 users 布局内。</p></>; }
