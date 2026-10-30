import styles from './{{{ name }}}.module.css';

export default function Page() {
  return (
    <div>
      <h1 className={styles.title}>Page {{{ name }}}</h1>
    </div>
  );
}
