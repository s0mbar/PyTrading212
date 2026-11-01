function TaxGuide() {
  return (
    <article className="card">
      <h2>Démarches</h2>
      <ol className="guide-list">
        <li>
          <strong>2047</strong> (revenus encaissés à l'étranger) : dividendes bruts, intérêts et crédits d'impôt. Les
          montants sont ensuite reportés sur la 2042 (2DC, 2TS, 2TR, 2AB).
        </li>
        <li>
          <strong>2042-C</strong> : plus-value nette en <strong>3VG</strong> ou moins-value en <strong>3VH</strong>.
          Conservez le détail des cessions (formulaire <strong>2074</strong>) avec les relevés Trading 212.
        </li>
        <li>
          <strong>3916</strong> : déclaration du compte Trading 212 (et de tout autre compte détenu à l'étranger).
        </li>
        <li>
          <strong>Case 2CK</strong> : Trading 212 ne prélève pas l'acompte de 12,8 % ni les prélèvements sociaux. Ils
          sont calculés à la déclaration ; l'acompte peut être versé en cours d'année (formulaire 2778-DIV).
        </li>
        <li>
          <strong>Case 2OP</strong> : à cocher seulement si le barème progressif est plus favorable que le PFU ; le
          choix s'applique à tous vos revenus de capitaux de l'année.
        </li>
      </ol>
      <p className="meta disclaimer">
        Outil d'aide au calcul, pas un conseil fiscal. Les règles (PMP, taux conventionnels, éligibilité à
        l'abattement) doivent être vérifiées sur les notices officielles de l'année sur impots.gouv.fr.
      </p>
    </article>
  );
}

export default TaxGuide;
