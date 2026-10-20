import { Link } from 'react-router';

export default function TeamIndex() {
  return <section>
    <h2>团队</h2>
    <p><Link to="/team/alpha">查看成员 alpha</Link></p>
    <p><Link to="/team/boom">查看会抛错的成员</Link></p>
  </section>;
}
