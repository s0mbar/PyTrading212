import type { AccountInfo, ForeignAccount } from "../../api/tax";
import { formatDate } from "../../lib/format";

type ForeignAccountCardProps = {
  account: ForeignAccount | null;
  accountInfo: AccountInfo | null;
};

function ForeignAccountCard({ account, accountInfo }: ForeignAccountCardProps) {
  return (
    <article className="card">
      <h2>Formulaire 3916 — compte ouvert à l'étranger</h2>
      <p className="meta">
        Obligatoire chaque année, même sans revenu et même si le compte a été clos dans l'année (amende de 1 500 € par
        compte non déclaré). Un formulaire par compte.
      </p>
      <dl className="facts">
        <dt>Établissement</dt>
        <dd>
          {account?.entity ?? "Trading 212 Markets Ltd"} — {account?.entity_country ?? "Chypre"}
          <small className="box-help">
            {account?.regulator ?? "CySEC, licence n° 398/21"}. Vérifiez l'entité et l'adresse exactes sur votre
            contrat ou vos relevés Trading 212.
          </small>
        </dd>
        <dt>Numéro de compte</dt>
        <dd>{accountInfo?.account_id ?? "Visible dans l'app Trading 212 (ou via la clé API)"}</dd>
        <dt>Nature / usage</dt>
        <dd>{account?.account_type ?? "Compte-titres"} — usage privé</dd>
        <dt>Devise</dt>
        <dd>{accountInfo?.currency ?? (account?.account_currencies.join(", ") || "-")}</dd>
        <dt>Première opération connue</dt>
        <dd>
          {formatDate(account?.first_activity)}
          <small className="box-help">Date d'ouverture : au plus tard cette date, à confirmer.</small>
        </dd>
      </dl>
    </article>
  );
}

export default ForeignAccountCard;
